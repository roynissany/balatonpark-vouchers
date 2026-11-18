import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Stripe's webhook. This is where vouchers are actually created — never on
// the browser's say-so, because anyone can open the success page.
//
// Three things make this safe:
//   1. the signature is verified against the raw body, so only Stripe can
//      trigger it;
//   2. the event id is recorded, so a redelivery does nothing twice;
//   3. fulfil_order() is itself idempotent, so even a race cannot mint a
//      second set of vouchers.
//
// Both shapes of sale land here: the payment intent raised by the card form
// on our own page, and the checkout session from Stripe's hosted page, which
// is still the fallback when no publishable key is configured.

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const TOLERANCE_SEC = 300;   // reject anything older than 5 minutes

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compare without leaking how much of the string matched.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(raw: string, header: string | null, secret: string) {
  if (!header) return { ok: false, reason: "missing_signature" };

  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") t = v?.trim() ?? "";
    if (k?.trim() === "v1") sigs.push(v?.trim() ?? "");
  }

  if (!t || sigs.length === 0) return { ok: false, reason: "malformed_signature" };

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)));

  return sigs.some((s) => safeEqual(s, mac))
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}

async function orderIdFrom(obj: Record<string, unknown>): Promise<string | null> {
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  if (meta.order_id) return meta.order_id;
  if (typeof obj.client_reference_id === "string") return obj.client_reference_id;

  // A refund arrives on the charge, which may only carry the payment intent.
  const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
  if (pi) {
    const { data } = await db.from("orders")
      .select("id").eq("stripe_payment_id", pi).maybeSingle();
    if (data) return data.id;
  }
  return null;
}

async function fulfil(orderId: string, paymentId: string | null): Promise<string> {
  const { data, error } = await db.rpc("fulfil_order", {
    p_order_id: orderId,
    p_payment_id: paymentId,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const handled = rows[0]?.already_done ? "already_fulfilled" : `issued_${rows.length}`;
  console.log(`order ${orderId}: ${handled}`);
  return handled;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  if (!WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return new Response("not configured", { status: 503 });
  }

  const raw = await req.text();
  const check = await verify(raw, req.headers.get("stripe-signature"), WEBHOOK_SECRET);

  if (!check.ok) {
    console.error("webhook rejected", check.reason);
    return new Response(check.reason ?? "bad signature", { status: 400 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const eventId = String(event.id ?? "");
  const type = String(event.type ?? "");
  const obj = ((event.data as Record<string, unknown>)?.object ?? {}) as Record<string, unknown>;

  // Seen before? Say OK and do nothing, so Stripe stops retrying.
  const { data: seen } = await db.from("stripe_events")
    .select("id").eq("id", eventId).maybeSingle();
  if (seen) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const orderId = await orderIdFrom(obj);
  let handled = "ignored";

  try {
    if (type === "payment_intent.succeeded") {
      // The card form on our own page. The intent carries the order id in
      // its metadata, set when the intent was created.
      if (!orderId) {
        console.error("no order id on", eventId);
      } else {
        handled = await fulfil(orderId, String(obj.id ?? "") || null);
      }
    } else if (type === "payment_intent.payment_failed") {
      if (orderId) {
        await db.from("orders").update({ status: "failed" })
          .eq("id", orderId).eq("status", "pending");
        handled = "marked_failed";
      }
    } else if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
      // Only fulfil once the money is actually there.
      const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
      if (!orderId) {
        console.error("no order id on", eventId);
      } else if (!paid) {
        handled = "awaiting_payment";
      } else {
        const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
        handled = await fulfil(orderId, pi);
      }
    } else if (type === "checkout.session.expired" || type === "checkout.session.async_payment_failed") {
      if (orderId) {
        await db.from("orders").update({ status: "failed" })
          .eq("id", orderId).eq("status", "pending");
        handled = "marked_failed";
      }
    } else if (type === "charge.refunded" || type === "charge.dispute.funds_withdrawn") {
      if (orderId) {
        const { error } = await db.rpc("refund_order", {
          p_order_id: orderId,
          p_actor: "stripe:" + type,
        });
        if (error) throw error;
        handled = "refunded";
      }
    }

    await db.from("stripe_events").insert({
      id: eventId,
      type,
      order_id: orderId,
      payload: { handled, livemode: event.livemode ?? null },
    });
  } catch (e) {
    // Do NOT record the event: returning 500 makes Stripe retry, and the
    // retry needs to find the work still undone.
    console.error("webhook handling failed", type, eventId, e);
    return new Response("handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true, handled }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
