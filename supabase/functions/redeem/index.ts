import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Redeem endpoint for gifts.balatonpark.com
//
//   POST { action: "lookup", code }
//        -> voucher, sessions left, codes already claimed,
//           and for each track day how many sessions can be taken there
//   POST { action: "claim", code, track_day_id, sessions }
//        -> one Cooltix code covering that many sessions on that day
//
// Sessions are spent a few at a time: a 6-session voucher can run 1 on one
// day, 2 on another and 3 on a third. Each group claims the Cooltix code
// whose value matches it. Day products (VIP) are all or nothing.
//
// Runs with the service role, so it is the only thing that ever sees the
// code pool. Failed attempts are logged and an address that fails too often
// is locked out for a while.

const MAX_FAILS = 8;          // failed lookups allowed...
const WINDOW_MIN = 15;        // ...within this many minutes

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const strip = (raw: unknown): string =>
  String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Accept the code however it was typed — lower case, spaces, missing or
// extra dashes — and rebuild the canonical BPC-XXXX-XXXX form.
function canonicalise(typed: unknown): string | null {
  const s = strip(typed);
  if (!/^BPC[A-Z0-9]{8}$/.test(s)) return null;
  return `BPC-${s.slice(3, 7)}-${s.slice(7, 11)}`;
}

const DEMO_SESSIONS = 6;

// A permanently valid code for showing the flow to someone. It is answered
// from memory: no voucher row, no pool touched, nothing to deplete and
// nothing to clean up afterwards. It never expires because there is no
// state to expire.
async function demo(body: Record<string, unknown>, action: string) {
  const { data: days } = await db
    .from("track_days")
    .select("id, event_date, public_label, cooltix_event_url")
    .eq("status", "published")
    .order("event_date");

  const labels: Record<number, string> = {
    1: "1 session", 2: "2 sessions", 3: "3 sessions",
    4: "4 sessions", 5: "5 sessions", 6: "6 sessions",
  };

  if (action === "claim") {
    const want = Number(body.sessions ?? 1);
    const sessions = Number.isInteger(want) && want >= 1 && want <= DEMO_SESSIONS ? want : 1;
    const day = (days ?? []).find((d) => d.id === String(body.track_day_id ?? ""))
      ?? (days ?? [])[0];
    if (!day) return { error: "track_day_unavailable" };

    const stamp = String(day.event_date).slice(5).replace("-", "");
    return {
      cooltix_code: `DEMO-${stamp}-S${sessions}`,
      sessions_claimed: sessions,
      sessions_left: DEMO_SESSIONS - sessions,
      fully_redeemed: sessions >= DEMO_SESSIONS,
      track_day: { date: day.event_date, label: day.public_label },
      booking_url: day.cooltix_event_url,
      pool_remaining: 200,
      demo: true,
    };
  }

  return {
    voucher: { code: "DEMO", package: "6 sessions", expires_on: null },
    splittable: true,
    sessions_total: DEMO_SESSIONS,
    sessions_remaining: DEMO_SESSIONS,
    parts: [],
    demo: true,
    dates: (days ?? []).map((d) => ({
      track_day_id: d.id,
      event_date: d.event_date,
      label: d.public_label,
      options: [1, 2, 3, 4, 5, 6].map((n) => ({
        sessions: n, label: labels[n], available: true,
      })),
      selectable: true,
    })),
  };
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : null;
}

async function lockedOut(ip: string | null): Promise<boolean> {
  if (!ip) return false;
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { count, error } = await db
    .from("redemption_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("succeeded", false)
    .gte("created_at", since);
  if (error) {
    console.error("rate check failed", error);
    return false;                       // never lock people out on our bug
  }
  return (count ?? 0) >= MAX_FAILS;
}

async function logAttempt(
  code: string,
  ip: string | null,
  ua: string | null,
  ok: boolean,
) {
  const { error } = await db.from("redemption_attempts").insert({
    code_tried: String(code).slice(0, 40),
    ip,
    user_agent: ua?.slice(0, 300) ?? null,
    succeeded: ok,
  });
  if (error) console.error("attempt log failed", error);
}

// Whoever holds the voucher code is entitled to see the codes it has already
// been exchanged for. This matters when a claim succeeded in the database but
// the reply never reached them — a dropped connection, a closed laptop.
async function partsOf(voucherId: string) {
  const { data, error } = await db
    .from("voucher_parts")
    .select("part_number, sessions, event_date, public_label, " +
            "cooltix_event_url, package_name, cooltix_code")
    .eq("voucher_id", voucherId)
    .order("part_number");
  if (error) {
    console.error("parts lookup failed", error);
    return [];
  }
  return (data ?? []).map((p) => ({
    part: p.part_number,
    sessions: p.sessions,
    cooltix_code: p.cooltix_code,
    covers: p.package_name,
    track_day: { date: p.event_date, label: p.public_label },
    booking_url: p.cooltix_event_url,
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const ip = clientIp(req);
  const ua = req.headers.get("user-agent");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const action = String(body.action ?? "lookup");
  const typed = String(body.code ?? "");

  // Answered before the rate limiter and before any lookup: the demo code is
  // meant to be typed wrongly, repeatedly, by people being shown the site.
  if (strip(typed) === "DEMO") {
    const out = await demo(body, action);
    return json(out, (out as Record<string, unknown>).error ? 409 : 200);
  }

  if (await lockedOut(ip)) {
    return json({ error: "too_many_attempts", retry_after_minutes: WINDOW_MIN }, 429);
  }

  const code = canonicalise(typed);
  if (!code) {
    await logAttempt(typed, ip, ua, false);
    return json({ error: "not_found" }, 404);
  }

  const { data: voucher, error: vErr } = await db
    .from("vouchers")
    .select("id, code, status, expires_on, face_value_cents, package_id, " +
            "sessions_total, sessions_remaining")
    .eq("code", code)
    .maybeSingle();

  // A database failure is not the same as a wrong code. Say so, loudly,
  // rather than telling a paying customer their voucher does not exist.
  if (vErr) {
    console.error("voucher lookup failed", vErr);
    return json({ error: "server_error" }, 500);
  }

  if (!voucher) {
    await logAttempt(typed, ip, ua, false);
    return json({ error: "not_found" }, 404);
  }

  if (voucher.status === "refunded" || voucher.status === "void") {
    await logAttempt(typed, ip, ua, false);
    return json({ error: "voucher_void" }, 409);
  }

  // Fully used: hand back what it bought, not a dead end.
  if (voucher.status === "redeemed") {
    await logAttempt(typed, ip, ua, true);
    return json({
      voucher: { code: voucher.code },
      fully_redeemed: true,
      parts: await partsOf(voucher.id),
    });
  }

  if (voucher.expires_on && new Date(voucher.expires_on) < new Date()) {
    await logAttempt(typed, ip, ua, false);
    return json({ error: "expired", expires_on: voucher.expires_on }, 409);
  }

  const { data: pkg, error: pErr } = await db
    .from("packages")
    .select("id, code, name, session_count, includes_room, splittable")
    .eq("id", voucher.package_id)
    .maybeSingle();

  if (pErr || !pkg) {
    console.error("package lookup failed", pErr);
    return json({ error: "server_error" }, 500);
  }

  // ---- lookup
  if (action === "lookup") {
    await logAttempt(typed, ip, ua, true);

    const left = voucher.sessions_remaining;

    // Which pools have stock, per track day. For a splittable voucher the
    // pools are the session denominations up to what is left; for a day
    // product it is that product's own pool.
    const { data: pools, error: poolErr } = await db
      .from("pool_levels")
      .select("track_day_id, event_date, public_label, package_code, available")
      .order("event_date");

    if (poolErr) {
      console.error("pool lookup failed", poolErr);
      return json({ error: "server_error" }, 500);
    }

    const { data: denoms } = await db
      .from("packages")
      .select("code, name, session_count")
      .eq("is_session_code", true)
      .order("session_count");

    const byDay = new Map<string, {
      track_day_id: string;
      event_date: string;
      label: string;
      options: { sessions: number; label: string; available: boolean }[];
    }>();

    for (const row of pools ?? []) {
      if (!byDay.has(row.track_day_id)) {
        byDay.set(row.track_day_id, {
          track_day_id: row.track_day_id,
          event_date: row.event_date,
          label: row.public_label,
          options: [],
        });
      }
      const day = byDay.get(row.track_day_id)!;
      const has = (row.available ?? 0) > 0;

      if (pkg.splittable) {
        const d = (denoms ?? []).find((x) => x.code === row.package_code);
        if (d && d.session_count && d.session_count <= left) {
          day.options.push({
            sessions: d.session_count,
            label: d.name,
            available: has,
          });
        }
      } else if (row.package_code === pkg.code) {
        day.options.push({ sessions: left, label: pkg.name, available: has });
      }
    }

    const dates = [...byDay.values()].map((d) => ({
      ...d,
      options: d.options.sort((a, b) => a.sessions - b.sessions),
      selectable: d.options.some((o) => o.available),
    }));

    return json({
      voucher: {
        code: voucher.code,
        package: pkg.name,
        expires_on: voucher.expires_on,
      },
      splittable: pkg.splittable,
      sessions_total: voucher.sessions_total,
      sessions_remaining: left,
      parts: await partsOf(voucher.id),
      dates,
    });
  }

  // ---- claim
  if (action === "claim") {
    const trackDayId = String(body.track_day_id ?? "");
    if (!trackDayId) return json({ error: "track_day_required" }, 400);

    // Missing means "all that is left", which is what a day product needs.
    const sessions = body.sessions === undefined || body.sessions === null
      ? null
      : Number(body.sessions);

    if (sessions !== null && (!Number.isInteger(sessions) || sessions < 1)) {
      return json({ error: "bad_session_count" }, 400);
    }

    const { data: day, error: dErr } = await db
      .from("track_days")
      .select("id, event_date, public_label, status, cooltix_event_url")
      .eq("id", trackDayId)
      .maybeSingle();

    if (dErr) {
      console.error("track day lookup failed", dErr);
      return json({ error: "server_error" }, 500);
    }
    if (!day || day.status !== "published") {
      return json({ error: "track_day_unavailable" }, 409);
    }

    const { data, error } = await db.rpc("claim_cooltix_code", {
      p_voucher_id: voucher.id,
      p_track_day_id: trackDayId,
      p_sessions: sessions,
    });

    if (error) {
      const msg = error.message ?? "";
      // Nothing is consumed on any of these: the voucher stays usable.
      if (msg.includes("pool_empty")) return json({ error: "pool_empty" }, 409);
      if (msg.includes("not_splittable")) return json({ error: "not_splittable" }, 409);
      if (msg.includes("bad_session_count")) return json({ error: "bad_session_count" }, 409);
      if (msg.includes("no_pool_for_session_count")) {
        return json({ error: "no_pool_for_session_count" }, 409);
      }
      if (msg.includes("voucher_not_redeemable")) {
        // Raced with another tab or a retry: return what it holds.
        return json({
          voucher: { code: voucher.code },
          fully_redeemed: true,
          parts: await partsOf(voucher.id),
        }, 200);
      }
      console.error("claim failed", error);
      return json({ error: "claim_failed" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;

    await db.from("audit_log").insert({
      action: "voucher_sessions_redeemed",
      voucher_id: voucher.id,
      detail: {
        track_day: day.event_date,
        sessions: row.sessions_claimed,
        sessions_left: row.sessions_left,
        ip,
      },
    });

    return json({
      cooltix_code: row.cooltix_code,
      sessions_claimed: row.sessions_claimed,
      sessions_left: row.sessions_left,
      fully_redeemed: row.fully_redeemed,
      track_day: { date: day.event_date, label: day.public_label },
      booking_url: day.cooltix_event_url,
      pool_remaining: row.pool_remaining,
    });
  }

  return json({ error: "unknown_action" }, 400);
});
