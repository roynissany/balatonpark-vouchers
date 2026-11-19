import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Backoffice reporting that reads and never writes.
//
//   POST { action: "attribution", days? }
//   POST { action: "traffic", days?, include_test? }
//   POST { action: "order_meta", order_id }
//
// Kept apart from the admin function on purpose. That one holds refunds and
// code minting; this one only reads, so it can be changed as often as a
// report needs changing without going anywhere near the money.
//
// Same door as the backoffice: a valid Supabase session whose address is an
// active row in admin_users. A working anon key on its own gets nothing.

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");

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

// The order the shop offers them in, so the report reads the same way as
// the question did.
const ANSWERS = ["instagram", "facebook", "search", "friend", "been", "other"];

async function authenticate(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!token) return null;

  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user?.email) return null;

  const email = data.user.email.toLowerCase();
  const { data: admin } = await db
    .from("admin_users")
    .select("email, active")
    .eq("email", email)
    .maybeSingle();

  if (!admin || !admin.active) return null;
  return admin.email;
}

function windowDays(body: Record<string, unknown>, fallback: number) {
  return Math.min(Math.max(Number(body.days ?? fallback), 1), 3650);
}

// Counts every order that reached the till, answered or not, so the share
// who answered is visible rather than assumed.
async function attribution(body: Record<string, unknown>) {
  const days = windowDays(body, 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data, error } = await db
    .from("orders")
    .select("heard_about, status, total_cents")
    .gte("created_at", since);

  if (error) throw error;

  const rows = data ?? [];
  const blank = () => ({ orders: 0, paid: 0, paid_cents: 0 });
  const tally: Record<string, ReturnType<typeof blank>> = {};
  for (const key of [...ANSWERS, "unanswered"]) tally[key] = blank();

  for (const r of rows) {
    const key = r.heard_about && ANSWERS.includes(r.heard_about)
      ? r.heard_about
      : "unanswered";
    const t = tally[key];
    t.orders += 1;
    // Revenue is only counted once the money actually arrived: a pending or
    // failed order says nothing about whether a channel sells.
    if (r.status === "paid") {
      t.paid += 1;
      t.paid_cents += Number(r.total_cents ?? 0);
    }
  }

  const answered = ANSWERS.reduce((n, k) => n + tally[k].orders, 0);

  return {
    days,
    total_orders: rows.length,
    answered,
    unanswered: tally.unanswered.orders,
    breakdown: ANSWERS.map((key) => ({ key, ...tally[key] })),
  };
}

// Traffic, from the counts captured out of the edge logs before they expire
// plus whatever the site has counted since.
//
// Days marked is_test were our own end-to-end testing and are left out
// unless asked for: they carry dozens of checkout starts that were never
// anyone trying to buy.
async function traffic(body: Record<string, unknown>) {
  const days = windowDays(body, 30);
  const includeTest = body.include_test === true;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // Which shop. Empty means both added together, which is what this answered
  // before the two shops existed separately.
  const wantSite = ["gift", "self"].includes(String(body.site ?? ""))
    ? String(body.site)
    : "";

  let q = db.from("traffic_daily").select("*").gte("day", since).order("day");
  if (!includeTest) q = q.eq("is_test", false);
  if (wantSite) q = q.eq("site", wantSite);

  // The split is its own query, deliberately NOT filtered by shop: the point
  // of showing it is being able to read one shop against the other, which a
  // filtered copy could not do - it would report zero for the shop not
  // selected.
  let splitQ = db.from("traffic_daily")
    .select("site, hits, visitors, shop_views").gte("day", since);
  if (!includeTest) splitQ = splitQ.eq("is_test", false);

  const [
    { data: rows, error },
    { data: orderRows, error: oErr },
    { count: testDays },
    { data: splitRows },
  ] = await Promise.all([
    q,
    db.from("orders").select("created_at, status, total_cents, channel")
      .gte("created_at", since + "T00:00:00Z"),
    db.from("traffic_daily").select("day", { count: "exact", head: true })
      .gte("day", since).eq("is_test", true),
    splitQ,
  ]);
  if (error) throw error;
  if (oErr) throw oErr;

  const byDay = new Map<string, Record<string, number>>();
  const byCountry = new Map<string, { hits: number; visitors: number }>();
  // Always reported, whichever shop is being looked at, so the split is
  // visible without having to switch back and forth.
  const bySite = new Map<string, { hits: number; visitors: number; shop_views: number }>();
  const sum = {
    hits: 0, visitors: 0, mobile_hits: 0, instagram_hits: 0,
    facebook_hits: 0, shop_views: 0, checkout_starts: 0, redeems: 0,
  };

  for (const r of rows ?? []) {
    const d = String(r.day);
    if (!byDay.has(d)) {
      byDay.set(d, { visitors: 0, shop_views: 0, hits: 0, checkout_starts: 0, social: 0 });
    }
    const day = byDay.get(d)!;
    day.visitors += r.visitors;
    day.shop_views += r.shop_views;
    day.hits += r.hits;
    day.checkout_starts += r.checkout_starts;
    day.social += r.instagram_hits + r.facebook_hits;

    const c = byCountry.get(r.country) ?? { hits: 0, visitors: 0 };
    c.hits += r.hits;
    c.visitors += r.visitors;
    byCountry.set(r.country, c);

    for (const k of Object.keys(sum) as (keyof typeof sum)[]) {
      sum[k] += Number(r[k] ?? 0);
    }
  }

  for (const r of splitRows ?? []) {
    const sName = String(r.site ?? "gift");
    const s = bySite.get(sName) ?? { hits: 0, visitors: 0, shop_views: 0 };
    s.hits += Number(r.hits ?? 0);
    s.visitors += Number(r.visitors ?? 0);
    s.shop_views += Number(r.shop_views ?? 0);
    bySite.set(sName, s);
  }

  // Orders are counted only on days the traffic covers, so the conversion
  // rate has the same denominator as its numerator - and when one shop is
  // being looked at, only that shop's orders count, or the rate would be
  // one shop's sales over the other shop's visitors.
  const counted = (o: { created_at: string; channel?: string | null }) =>
    byDay.has(String(o.created_at).slice(0, 10)) &&
    (!wantSite || (o.channel === "self" ? "self" : "gift") === wantSite);
  const inScope = (orderRows ?? []).filter(counted);
  const paid = inScope.filter((o) => o.status === "paid");
  const revenue_cents = paid.reduce((n, o) => n + Number(o.total_cents ?? 0), 0);

  return {
    days,
    site: wantSite || "all",
    by_site: ["gift", "self"].map((s) => ({
      site: s,
      ...(bySite.get(s) ?? { hits: 0, visitors: 0, shop_views: 0 }),
    })),
    excluded_test_days: testDays ?? 0,
    // Visitors are distinct addresses within a day, so a period total is a
    // sum of days and counts somebody who returned twice as two.
    visitors: sum.visitors,
    shop_views: sum.shop_views,
    hits: sum.hits,
    views_per_visitor: sum.visitors ? sum.shop_views / sum.visitors : 0,
    mobile_hits: sum.mobile_hits,
    mobile_share: sum.hits ? sum.mobile_hits / sum.hits : 0,
    social_hits: sum.instagram_hits + sum.facebook_hits,
    instagram_hits: sum.instagram_hits,
    facebook_hits: sum.facebook_hits,
    checkout_starts: sum.checkout_starts,
    redeems: sum.redeems,
    orders: inScope.length,
    paid_orders: paid.length,
    revenue_cents,
    conversion: sum.visitors ? paid.length / sum.visitors : 0,
    countries: [...byCountry.entries()]
      .map(([country, v]) => ({ country, ...v }))
      .sort((a, b) => b.hits - a.hits),
    series: [...byDay.entries()].map(([day, v]) => ({ day, ...v })),
  };
}

// How an order was actually paid, and what tax document actually came back.
//
// The payment method is read from Stripe at the moment it is asked for
// rather than copied into a column: Stripe is the record of what happened,
// a stored copy would need the webhook to fill it, and it would say nothing
// about the orders already taken.
async function orderMeta(body: Record<string, unknown>) {
  const orderId = String(body.order_id ?? "").trim();
  if (!orderId) return { error: "order_id_required" };

  const { data: order, error } = await db
    .from("orders")
    .select(
      `id, status, total_cents, stripe_payment_id,
       invoice_kind, invoice_number, invoice_url, invoice_error, invoiced_at`,
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!order) return { error: "not_found" };

  // What we asked Szamlazz for, and what is actually in hand. They are not
  // the same question: an order can be marked for a szamla and still have
  // nothing issued, which is the case worth seeing at a glance.
  const invoice = {
    requested: order.invoice_kind ?? null,
    issued: order.invoice_number ? (order.invoice_kind ?? "nyugta") : null,
    number: order.invoice_number ?? null,
    url: order.invoice_url ?? null,
    at: order.invoiced_at ?? null,
    error: order.invoice_error ?? null,
  };

  let payment: Record<string, unknown> | null = null;
  let payment_error: string | null = null;

  if (!order.stripe_payment_id) {
    payment_error = "no_payment_on_order";
  } else if (!STRIPE_KEY) {
    payment_error = "payments_not_configured";
  } else {
    try {
      // Both shapes are asked for because which one comes back depends on
      // the account's API version: latest_charge from 2022-11-15 onwards,
      // charges.data before it. Expanding one that does not exist is
      // harmless, so this works either way rather than guessing.
      const url = `https://api.stripe.com/v1/payment_intents/${order.stripe_payment_id}` +
        `?expand[]=latest_charge&expand[]=charges.data`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${STRIPE_KEY}` },
      });
      const pi = await res.json();

      if (!res.ok) {
        payment_error = pi?.error?.message ?? "stripe_error";
      } else {
        const charge = pi.latest_charge ?? pi.charges?.data?.[0] ?? null;
        const d = charge?.payment_method_details ?? null;
        const card = d?.card ?? null;
        if (!d) {
          payment_error = "no_charge_yet";
        } else {
          payment = {
            // 'card', 'revolut_pay', 'link', and so on.
            type: d.type ?? null,
            brand: card?.brand ?? null,
            last4: card?.last4 ?? null,
            // Apple Pay and Google Pay arrive as a card with a wallet on it,
            // not as a payment method of their own.
            wallet: card?.wallet?.type ?? null,
            country: card?.country ?? null,
          };
        }
      }
    } catch (e) {
      console.error("stripe lookup failed", e);
      payment_error = "stripe_unreachable";
    }
  }

  return { order_id: order.id, status: order.status, invoice, payment, payment_error };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = await authenticate(req);
  if (!admin) return json({ error: "unauthorised" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  try {
    const action = String(body.action ?? "");
    if (action === "attribution") return json(await attribution(body));
    if (action === "traffic") return json(await traffic(body));
    if (action === "order_meta") return json(await orderMeta(body));
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("insights", e);
    return json({ error: "server_error" }, 500);
  }
});
