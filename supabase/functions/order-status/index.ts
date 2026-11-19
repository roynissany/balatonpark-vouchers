import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// What the thank-you page is allowed to see about one order.
//
//   POST { order_id } -> { status, gifts: [{ recipient, delivery, vouchers }] }
//
// The order id is a random UUID that only the buyer is handed, on their own
// return from Stripe. Voucher codes are released only once the order is paid,
// so a guessed id on an unpaid order yields nothing worth having.
//
// Stripe sends the buyer back the instant the card clears, often before the
// webhook has landed, so a "pending" answer here means "not yet", not "no" -
// the page polls.
//
// Nothing here exposes the buyer's billing address or tax number, only which
// kind of document is coming, so the page can name it correctly.

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Gift = {
  recipient_name: string | null;
  recipient_email: string | null;
  gift_message: string | null;
  delivery_method: string;
  deliver_at: string | null;
  lang: string | null;
  emailed: boolean;
  vouchers: Record<string, unknown>[];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const id = String(body.order_id ?? "").trim();
  if (!UUID.test(id)) return json({ error: "not_found" }, 404);

  const { data: order, error } = await db
    .from("orders")
    .select("id, status, buyer_name, buyer_email, recipient_name, recipient_email, " +
            "gift_message, delivery_method, deliver_at, gifts, total_cents, paid_at, " +
            "lang, invoice_kind, invoice_number")
    .eq("id", id)
    .maybeSingle();

  // A database wobble must not be reported as "your order does not exist" to
  // somebody who has just been charged.
  if (error) {
    console.error("order lookup failed", error);
    return json({ error: "server_error" }, 500);
  }
  if (!order) return json({ error: "not_found" }, 404);

  if (order.status !== "paid" && order.status !== "refunded") {
    return json({ status: order.status, gifts: [], vouchers: [] });
  }

  const [{ data: vouchers, error: vErr }, { data: sent }] = await Promise.all([
    db.from("vouchers")
      .select("code, status, sessions_total, sessions_remaining, expires_on, gift_index, " +
              "variant_name, packages ( name, code, ticket_mark, is_experience )")
      .eq("order_id", id)
      .order("gift_index", { ascending: true, nullsFirst: true })
      .order("created_at"),
    // Which gifts actually had something go out. The page must not promise
    // an email that was never sent.
    db.from("email_log")
      .select("gift_index")
      .eq("order_id", id)
      .eq("status", "sent")
      .eq("template", "gift"),
  ]);

  if (vErr) {
    console.error("voucher lookup failed", vErr);
    return json({ error: "server_error" }, 500);
  }

  const sentFor = new Set<number>();
  let sentAny = false;
  for (const row of sent ?? []) {
    sentAny = true;
    if (typeof row.gift_index === "number") sentFor.add(row.gift_index);
  }

  // ticket_mark and is_experience are here so a page can draw the same
  // ticket face the email does. Without them an experience voucher renders
  // as "ONE SESSION", because fulfil_order gives every non-session package a
  // sessions_total of 1.
  const shape = (v: Record<string, unknown>) => {
    const pk = v.packages as
      { name?: string; code?: string; ticket_mark?: string; is_experience?: boolean } | null;
    return {
      code: v.code,
      status: v.status,
      package: pk?.name ?? "",
      package_code: pk?.code ?? "",
      ticket_mark: pk?.ticket_mark ?? null,
      is_experience: !!pk?.is_experience,
      // Which car, where the package is sold by the car. The thank-you page
      // draws the same ticket as the email and needs the same line on it.
      variant_name: v.variant_name ?? null,
      sessions_total: v.sessions_total,
      sessions_remaining: v.sessions_remaining,
      expires_on: v.expires_on,
    };
  };

  // An order raised before gifts existed has one recipient at the top level.
  const raw = Array.isArray(order.gifts) && order.gifts.length
    ? order.gifts as Record<string, unknown>[]
    : [{
      recipient_name: order.recipient_name,
      recipient_email: order.recipient_email,
      gift_message: order.gift_message,
      delivery_method: order.delivery_method,
      deliver_at: order.deliver_at,
      lang: order.lang,
    }];

  const gifts: Gift[] = raw.map((g, i) => ({
    recipient_name: (g.recipient_name as string) ?? null,
    recipient_email: (g.recipient_email as string) ?? null,
    gift_message: (g.gift_message as string) ?? null,
    delivery_method: String(g.delivery_method ?? "now"),
    deliver_at: (g.deliver_at as string) ?? null,
    lang: (g.lang as string) ?? (order.lang as string) ?? null,
    emailed: sentFor.has(i) || (raw.length === 1 && sentAny),
    vouchers: [],
  }));

  for (const v of vouchers ?? []) {
    const i = typeof v.gift_index === "number" ? v.gift_index : 0;
    (gifts[i] ?? gifts[0]).vouchers.push(shape(v as Record<string, unknown>));
  }

  return json({
    status: order.status,
    buyer_name: order.buyer_name,
    buyer_email: order.buyer_email,
    total_cents: order.total_cents,
    paid_at: order.paid_at,
    lang: order.lang,
    invoice_kind: order.invoice_kind,
    invoice_number: order.invoice_number,
    emailed: sentAny,
    gifts,
    // Kept flat as well, so anything still reading the old shape works.
    recipient_name: order.recipient_name,
    recipient_email: order.recipient_email,
    delivery_method: order.delivery_method,
    deliver_at: order.deliver_at,
    vouchers: (vouchers ?? []).map((v) => shape(v as Record<string, unknown>)),
  });
});
