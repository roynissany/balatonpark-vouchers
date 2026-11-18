import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Backoffice API. One POST endpoint, { action, ... }.
//
// Every request carries a Supabase Auth access token. Having a valid login is
// not enough: the address on that token must also appear in admin_users with
// active = true. Accounts are created by invitation only, so there is no
// sign-up path anywhere in the system - an attacker with a working Supabase
// anon key still has nothing to log in as.
//
// Anything that changes money or codes writes an audit_log row naming the
// admin who did it.

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

const text = (body: string, status = 200, filename?: string) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      ...(filename ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}),
      ...CORS,
    },
  });

type Admin = { email: string; full_name: string | null };

// Columns the backoffice reads off an order, including enough about the tax
// document to flag the ones that still need a human.
const ORDER_COLS =
  `id, status, buyer_name, buyer_email, recipient_name, recipient_email,
   delivery_method, total_cents, paid_at, invoice_kind, invoice_number,
   invoice_error, invoiced_at`;

// ---------------------------------------------------------------- auth

async function authenticate(req: Request): Promise<Admin | null> {
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
    .select("email, full_name, active")
    .eq("email", email)
    .maybeSingle();

  if (!admin || !admin.active) return null;
  return { email: admin.email, full_name: admin.full_name };
}

// ---------------------------------------------------------------- reads

async function overview() {
  const [{ data: liability }, { data: pools }, { data: revenue }, { count: needDoc }] =
    await Promise.all([
      db.from("liability_summary").select("*").maybeSingle(),
      db.from("pool_levels").select("*").order("event_date"),
      db.from("revenue_summary").select("*").maybeSingle(),
      // Paid, but no receipt or invoice number on it yet.
      db.from("orders").select("id", { count: "exact", head: true })
        .eq("status", "paid").is("invoice_number", null),
    ]);

  // The threshold Roy asked for: shout while there is still time to load
  // another batch into Cooltix, not once the pool is dry.
  const low = (pools ?? []).filter((p: Record<string, unknown>) =>
    Number(p.available ?? 0) < Number(p.total ?? 0) * 0.2
  );

  return { liability, revenue, pools: pools ?? [], low,
           paid_orders: revenue?.paid_orders ?? 0,
           orders_without_document: needDoc ?? 0 };
}

// Paid orders with no document, newest first, so they can be worked through.
async function needsDocument(body: Record<string, unknown>) {
  const limit = Math.min(Number(body.limit ?? 100), 500);
  const { data, error } = await db
    .from("orders")
    .select(`${ORDER_COLS}, items, gross_cents, discount_cents, vat_rate, lang,
             invoice_name, invoice_tax_number, invoice_country, invoice_postcode,
             invoice_city, invoice_address`)
    .eq("status", "paid")
    .is("invoice_number", null)
    .order("paid_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { orders: data ?? [] };
}

async function voucherList(body: Record<string, unknown>) {
  const q = String(body.q ?? "").trim();
  const status = String(body.status ?? "").trim();
  const limit = Math.min(Number(body.limit ?? 50), 200);
  const offset = Math.max(Number(body.offset ?? 0), 0);

  let query = db
    .from("vouchers")
    .select(
      `id, code, status, sessions_total, sessions_remaining, face_value_cents,
       paid_value_cents, expires_on, created_at,
       packages!inner ( code, name ),
       orders!inner ( ${ORDER_COLS} )`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);

  if (q) {
    // Voucher code, or either side of the gift.
    const like = `%${q}%`;
    query = query.or(
      `code.ilike.${like},orders.buyer_email.ilike.${like},` +
      `orders.recipient_email.ilike.${like},orders.buyer_name.ilike.${like},` +
      `orders.recipient_name.ilike.${like}`,
    );
  }

  const { data, count, error } = await query;
  if (error) throw error;
  return { vouchers: data ?? [], total: count ?? 0, limit, offset };
}

// Staff retype these off the phone, so accept any spacing or casing.
function canonicalVoucherCode(raw: string): string {
  const bare = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^BPC/, "");
  return bare.length === 8 ? `BPC-${bare.slice(0, 4)}-${bare.slice(4)}` : raw.toUpperCase();
}

async function voucherDetail(body: Record<string, unknown>) {
  const code = canonicalVoucherCode(String(body.code ?? ""));
  const id = String(body.voucher_id ?? "");

  let q = db.from("vouchers").select(
    `id, code, status, sessions_total, sessions_remaining, face_value_cents,
     paid_value_cents, expires_on, created_at, redeemed_at,
     packages ( code, name, session_count ),
     orders ( id, status, buyer_name, buyer_email, recipient_name, recipient_email,
              gift_message, delivery_method, deliver_at, gross_cents, discount_cents,
              total_cents, vat_rate, stripe_payment_id, invoice_kind, invoice_number,
              invoice_url, invoice_error, invoiced_at, invoice_name,
              invoice_tax_number, invoice_country, invoice_postcode, invoice_city,
              invoice_address, created_at, paid_at )`,
  );

  q = id ? q.eq("id", id) : q.eq("code", code);

  const { data: voucher, error } = await q.maybeSingle();
  if (error) throw error;
  if (!voucher) return { error: "not_found" };

  const { data: parts } = await db
    .from("voucher_redemptions")
    .select(
      `id, part_number, sessions, created_at,
       track_days ( id, event_date, public_label ),
       cooltix_codes ( code, status ),
       packages ( code, name )`,
    )
    .eq("voucher_id", voucher.id)
    .order("part_number");

  const { data: log } = await db
    .from("audit_log")
    .select("id, actor_email, action, detail, created_at")
    .eq("voucher_id", voucher.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: emails } = await db
    .from("email_log")
    .select("id, to_address, template, status, created_at")
    .eq("voucher_id", voucher.id)
    .order("created_at", { ascending: false });

  return { voucher, parts: parts ?? [], audit: log ?? [], emails: emails ?? [] };
}

async function trackDays() {
  const { data } = await db
    .from("track_days")
    .select("id, event_date, public_label, status, cooltix_event_url")
    .order("event_date");
  return { track_days: data ?? [] };
}

async function packageList() {
  const { data } = await db
    .from("packages")
    .select("code, name, price_cents, session_count, sellable, splittable, active")
    .order("sort_order");
  return { packages: data ?? [] };
}

// Purchases, redemptions, refunds and staff changes on one timeline, newest
// first. Each row carries its order, so the list can refund in place.
async function activityFeed(body: Record<string, unknown>) {
  const kind = String(body.kind ?? "").trim();
  const limit = Math.min(Number(body.limit ?? 100), 500);
  const offset = Math.max(Number(body.offset ?? 0), 0);

  let q = db
    .from("activity_feed")
    .select("*", { count: "exact" })
    .order("at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (kind) q = q.eq("kind", kind);

  const { data, count, error } = await q;
  if (error) throw error;
  return { activity: data ?? [], total: count ?? 0, limit, offset };
}

// ---------------------------------------------------------------- writes

// Ask Szamlazz for the document again. Useful the moment a permission or a
// setting that was blocking it has been put right.
async function retryInvoice(body: Record<string, unknown>, admin: Admin) {
  const orderId = String(body.order_id ?? "");
  if (!orderId) return json({ error: "order_id_required" }, 400);

  const { data: tok } = await db.from("settings").select("value")
    .eq("key", "send_token").maybeSingle();
  const token = typeof tok?.value === "string"
    ? tok.value
    : JSON.stringify(tok?.value ?? "").replace(/"/g, "");
  if (!token) return json({ error: "send_token_missing" }, 503);

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-send-token": token },
    body: JSON.stringify({ order_id: orderId }),
  });
  const out = await res.json().catch(() => ({}));

  await db.from("audit_log").insert({
    actor_email: admin.email,
    action: "invoice_retry",
    detail: { order_id: orderId, ok: res.ok, response: out },
  });

  if (!res.ok) return json({ error: "invoice_failed", detail: out }, 502);
  return json({ ok: true, result: out });
}

// Issued by hand in Szamlazz: record the number so the order stops being
// flagged and the books line up.
async function markInvoiced(body: Record<string, unknown>, admin: Admin) {
  const orderId = String(body.order_id ?? "");
  const number = String(body.invoice_number ?? "").trim().slice(0, 60);
  if (!orderId) return json({ error: "order_id_required" }, 400);
  if (!number) return json({ error: "invoice_number_required" }, 400);

  const { data: order } = await db.from("orders")
    .select("id, status, invoice_number").eq("id", orderId).maybeSingle();
  if (!order) return json({ error: "order_not_found" }, 404);
  if (order.invoice_number) return json({ error: "already_recorded", number: order.invoice_number }, 409);

  const { error } = await db.from("orders").update({
    invoice_number: number,
    invoiced_at: new Date().toISOString(),
    invoice_error: null,
  }).eq("id", orderId);
  if (error) return json({ error: error.message }, 400);

  await db.from("audit_log").insert({
    actor_email: admin.email,
    action: "invoice_marked_manual",
    detail: { order_id: orderId, invoice_number: number },
  });

  return json({ ok: true, invoice_number: number });
}

async function refund(body: Record<string, unknown>, admin: Admin) {
  const orderId = String(body.order_id ?? "");
  if (!orderId) return json({ error: "order_id_required" }, 400);

  const { data: order } = await db
    .from("orders")
    .select("id, status, stripe_payment_id, total_cents")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return json({ error: "order_not_found" }, 404);
  if (order.status === "refunded") return json({ error: "already_refunded" }, 409);
  if (order.status !== "paid") return json({ error: "order_not_paid" }, 409);

  // Send the money back first. If Stripe refuses, nothing in our own tables
  // has moved, and the voucher is still valid - which is the right way round.
  if (!STRIPE_KEY) return json({ error: "payments_not_configured" }, 503);
  if (!order.stripe_payment_id) return json({ error: "no_payment_on_order" }, 409);

  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `refund_${orderId}`,
    },
    body: new URLSearchParams({
      payment_intent: order.stripe_payment_id,
      reason: "requested_by_customer",
      "metadata[order_id]": orderId,
      "metadata[refunded_by]": admin.email,
    }),
  });

  const refundRes = await res.json();
  if (!res.ok) {
    console.error("stripe refund failed", refundRes);
    return json({ error: "stripe_refund_failed", detail: refundRes?.error?.message }, 502);
  }

  // Void locally straight away rather than waiting on the webhook, so the
  // backoffice shows the truth the moment the page refreshes. The webhook's
  // later call lands on an already-refunded order and changes nothing.
  const { data: result, error } = await db.rpc("refund_order", {
    p_order_id: orderId,
    p_actor: admin.email,
  });
  if (error) {
    console.error("refund_order failed after stripe refund", error);
    return json({ error: "refunded_in_stripe_but_not_locally", stripe_refund: refundRes.id }, 500);
  }

  return json({ ok: true, stripe_refund: refundRes.id, result });
}

async function changeDate(body: Record<string, unknown>, admin: Admin) {
  const { data, error } = await db.rpc("admin_change_redemption_date", {
    p_redemption_id: String(body.redemption_id ?? ""),
    p_new_track_day_id: String(body.track_day_id ?? ""),
    p_actor: admin.email,
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, result: data });
}

async function changePackage(body: Record<string, unknown>, admin: Admin) {
  const { data, error } = await db.rpc("admin_change_package", {
    p_voucher_id: String(body.voucher_id ?? ""),
    p_new_package_code: String(body.package_code ?? ""),
    p_actor: admin.email,
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, result: data });
}

async function generateCodes(body: Record<string, unknown>, admin: Admin) {
  const { data, error } = await db.rpc("admin_generate_codes", {
    p_track_day_id: String(body.track_day_id ?? ""),
    p_package_code: String(body.package_code ?? ""),
    p_count: Number(body.count ?? 0),
    p_actor: admin.email,
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, codes: (data ?? []).map((r: { code: string }) => r.code) });
}

// The file Cooltix wants: one column, codes only, no header.
async function exportCsv(body: Record<string, unknown>) {
  const trackDayId = String(body.track_day_id ?? "");
  const packageCode = String(body.package_code ?? "");
  const batch = String(body.batch_label ?? "");

  let q = db.from("cooltix_codes").select("code, batch_label, track_days!inner(event_date), packages!inner(code)");
  if (batch) {
    q = q.eq("batch_label", batch);
  } else {
    if (!trackDayId || !packageCode) return json({ error: "need_batch_or_day_and_package" }, 400);
    q = q.eq("track_day_id", trackDayId).eq("packages.code", packageCode).eq("status", "available");
  }

  const { data, error } = await q.order("created_at");
  if (error) throw error;
  if (!data?.length) return json({ error: "nothing_to_export" }, 404);

  const name = batch || `${packageCode}-${trackDayId.slice(0, 8)}`;
  return text(data.map((r: { code: string }) => r.code).join("\r\n") + "\r\n", 200, `cooltix-${name}.csv`);
}

// ---------------------------------------------------------------- router

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

  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "me":          return json({ admin });
      case "overview":    return json(await overview());
      case "vouchers":    return json(await voucherList(body));
      case "voucher":     return json(await voucherDetail(body));
      case "needs_document": return json(await needsDocument(body));
      case "track_days":  return json(await trackDays());
      case "packages":    return json(await packageList());
      case "activity":    return json(await activityFeed(body));
      case "refund":          return await refund(body, admin);
      case "change_date":     return await changeDate(body, admin);
      case "change_package":  return await changePackage(body, admin);
      case "generate_codes":  return await generateCodes(body, admin);
      case "export_csv":      return await exportCsv(body);
      case "retry_invoice":   return await retryInvoice(body, admin);
      case "mark_invoiced":   return await markInvoiced(body, admin);
      default:            return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error(action, e);
    return json({ error: "server_error" }, 500);
  }
});
