import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Starts a purchase.
//
//   POST { gifts: [{ items: [{ package_code, qty }], recipient_email,
//                    recipient_name, gift_message, delivery_method,
//                    deliver_at, lang }],
//          buyer_email, buyer_name, lang, channel?,
//          invoice?: { name, tax_number, country, postcode, city, address } }
//
// One order can carry several gifts, each going to its own person on its
// own schedule, in its own language, paid for in one go. The volume tier is
// worked out across everything in the basket, so buying for four people
// reaches the deeper discount that buying for one would not.
//
// channel says which shop raised the order: "gift" (the default, and what
// every order written before the column existed is) or "self", the
// experience shop, where the buyer is the attendee. It decides nothing about
// money - only which site the buyer is sent back to and which wording the
// emails use.
//
// The older flat shape (items + recipient at the top level) is still
// accepted and read as a single gift, so a page cached from before this
// change cannot fail at the till.
//
// Every price and every discount is recalculated here from the database.
// Nothing the browser sends about money is trusted or even read.
//
// Nothing is issued at this point. Vouchers are only minted when Stripe
// confirms payment, through the webhook.

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_PK = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? "";
const ON_PAGE = STRIPE_PK.startsWith("pk_");

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

const MAX_QTY_PER_LINE = 20;
const MAX_GIFTS = 25;
const LANGS = ["en", "hu"];
// Whitelisted here rather than with a check constraint on the column: a
// third shop must never be able to fail an insert at the till.
const CHANNELS = ["gift", "self"];

const lang = (v: unknown, fallback = "en") => {
  const s = String(v ?? "").toLowerCase().slice(0, 2);
  return LANGS.includes(s) ? s : fallback;
};

const trim = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max) || null;

function validEmail(s: unknown): boolean {
  const v = String(s ?? "").trim();
  return v.length > 3 && v.length < 255 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

function formEncode(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      out.push(...formEncode(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object") {
          out.push(...formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function stripe(path: string, payload: Record<string, unknown>, idempotency: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotency,
    },
    body: formEncode(payload).join("&"),
  });
  return { ok: res.ok, body: await res.json() };
}

async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

type RawGift = Record<string, unknown>;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!STRIPE_KEY) {
    console.error("STRIPE_SECRET_KEY is not set");
    return json({ error: "payments_not_configured" }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const buyerEmail = String(body.buyer_email ?? "").trim().toLowerCase();
  if (!validEmail(buyerEmail)) return json({ error: "buyer_email_invalid" }, 400);

  const orderLang = lang(body.lang);
  const channel = CHANNELS.includes(String(body.channel ?? "")) ? String(body.channel) : "gift";
  const isGift = channel === "gift";

  // One shape to work with, whichever shape arrived.
  const rawGifts: RawGift[] = Array.isArray(body.gifts) && body.gifts.length
    ? body.gifts as RawGift[]
    : [{
      items: body.items,
      recipient_email: body.recipient_email,
      recipient_name: body.recipient_name,
      gift_message: body.gift_message,
      delivery_method: body.delivery_method,
      deliver_at: body.deliver_at,
      lang: body.lang,
    }];

  if (rawGifts.length > MAX_GIFTS) return json({ error: "too_many_gifts" }, 400);

  // ---- validate every gift before touching Stripe or the database
  const parsed: {
    recipient_email: string;
    recipient_name: string | null;
    gift_message: string | null;
    delivery_method: string;
    deliver_at: string | null;
    lang: string;
    wanted: Map<string, number>;
  }[] = [];

  for (let g = 0; g < rawGifts.length; g++) {
    const gift = rawGifts[g] ?? {};
    const recipientEmail = String(gift.recipient_email ?? "").trim().toLowerCase();
    if (!validEmail(recipientEmail)) {
      return json({ error: "recipient_email_invalid", gift: g }, 400);
    }

    const delivery = String(gift.delivery_method ?? "now");
    if (!["now", "scheduled", "print"].includes(delivery)) {
      return json({ error: "delivery_method_invalid", gift: g }, 400);
    }

    let deliverAt: string | null = null;
    if (delivery === "scheduled") {
      const when = new Date(String(gift.deliver_at ?? ""));
      if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000) {
        return json({ error: "deliver_at_invalid", gift: g }, 400);
      }
      deliverAt = when.toISOString();
    }

    const rawItems = Array.isArray(gift.items) ? gift.items : [];
    if (rawItems.length === 0) return json({ error: "no_items", gift: g }, 400);
    if (rawItems.length > 10) return json({ error: "too_many_lines", gift: g }, 400);

    const wanted = new Map<string, number>();
    for (const it of rawItems) {
      const code = String((it as Record<string, unknown>)?.package_code ?? "");
      const qty = Number((it as Record<string, unknown>)?.qty ?? 0);
      if (!code) return json({ error: "package_code_required", gift: g }, 400);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
        return json({ error: "qty_invalid", package_code: code, gift: g }, 400);
      }
      wanted.set(code, (wanted.get(code) ?? 0) + qty);
    }

    parsed.push({
      recipient_email: recipientEmail,
      recipient_name: String(gift.recipient_name ?? "").slice(0, 200) || null,
      gift_message: String(gift.gift_message ?? "").slice(0, 2000) || null,
      delivery_method: delivery,
      deliver_at: deliverAt,
      // each receiver reads in their own language, which need not be the
      // one the buyer is browsing in
      lang: lang(gift.lang, orderLang),
      wanted,
    });
  }

  // ---- prices and discounts, from the database only
  const codes = [...new Set(parsed.flatMap((p) => [...p.wanted.keys()]))];

  const { data: packages, error: pkgErr } = await db
    .from("packages")
    .select("code, name, price_cents, list_price_cents, session_count, splittable, sellable, in_ladder")
    .in("code", codes);

  if (pkgErr) {
    console.error("package lookup failed", pkgErr);
    return json({ error: "server_error" }, 500);
  }

  const { data: tiers, error: tierErr } = await db
    .from("discount_tiers")
    .select("min_sessions, percent, unit_cents")
    .not("min_sessions", "is", null)
    .order("min_sessions", { ascending: false });

  if (tierErr) {
    console.error("tier lookup failed", tierErr);
    return json({ error: "server_error" }, 500);
  }

  const currency = await setting<string>("currency", "eur");
  const vatRate = await setting<number>("vat_rate", 0.27);
  // Each shop is sent back to its own address after Stripe.
  const siteUrl = isGift
    ? await setting<string>("site_url", "https://gifts.balatonpark.com")
    : await setting<string>("site_url_self", "https://experience.balatonpark.com");

  const find = (code: string) => (packages ?? []).find((p) => p.code === code);

  // The tier is counted across the whole basket, not per gift: buying for
  // four people is what reaches the deeper discount.
  //
  // It is counted in SELECTIONS, not sessions. A session package counts its
  // own sessions, so 3 sessions still reaches the first tier exactly as it
  // did; anything else in the ladder counts one per unit, so three
  // experiences reach it too. Before this, adding experiences moved the
  // counter not at all and the basket's "{pct}% off everything" was a
  // promise it could not keep. The Tour and the open vouchers are out of the
  // ladder, so they neither count towards a tier nor take a discount from
  // one. discount_tiers.min_sessions keeps its name and now reads as a
  // number of selections.
  let totalPicks = 0;
  for (const p of parsed) {
    for (const [code, qty] of p.wanted) {
      const pkg = find(code);
      if (!pkg || pkg.in_ladder === false) continue;
      totalPicks += (pkg.splittable ? (pkg.session_count ?? 1) : 1) * qty;
    }
  }
  const tier = (tiers ?? []).find((t) => totalPicks >= t.min_sessions) ?? null;

  const gifts: Record<string, unknown>[] = [];
  const flatItems: Record<string, unknown>[] = [];
  const labels: string[] = [];
  let gross = 0;
  let total = 0;

  for (const p of parsed) {
    const items: Record<string, unknown>[] = [];

    for (const [code, qty] of p.wanted) {
      const pkg = find(code);
      if (!pkg) return json({ error: "unknown_package", package_code: code }, 400);
      if (!pkg.sellable) return json({ error: "package_not_for_sale", package_code: code }, 400);

      const list = pkg.list_price_cents ?? pkg.price_cents;
      const sessions = pkg.session_count ?? 1;
      // The tier comes off every package flagged in_ladder - which is what
      // the basket's own nudge ("{pct}% off everything") says. A session
      // package is priced from the tier's stated per-session figure;
      // anything else takes the tier's percentage off its own price, rounded
      // to whole euros because nothing on this product is ever sold in cents.
      const inLadder = pkg.in_ladder !== false;
      let tiered: number | null = null;
      if (tier && inLadder) {
        if (pkg.splittable && tier.unit_cents) {
          tiered = tier.unit_cents * sessions;
        } else if (!pkg.splittable && tier.percent) {
          tiered = Math.round(pkg.price_cents * (100 - tier.percent) / 10000) * 100;
        }
      }
      const unit = tiered ?? pkg.price_cents;
      const line = unit * qty;

      gross += list * qty;
      total += line;
      labels.push(`${qty} × ${pkg.name}`);

      const row = {
        package_code: code,
        name: pkg.name,
        qty,
        unit_cents: unit,
        list_unit_cents: list,
        discount_percent: tiered !== null
          ? tier!.percent
          : (list ? Math.round((1 - unit / list) * 100) : 0),
        line_cents: line,
      };
      items.push(row);
      flatItems.push(row);
    }

    gifts.push({
      recipient_email: p.recipient_email,
      recipient_name: p.recipient_name,
      gift_message: p.gift_message,
      delivery_method: p.delivery_method,
      deliver_at: p.deliver_at,
      lang: p.lang,
      items,
    });
  }

  if (total < 50) return json({ error: "amount_too_small" }, 400);

  const first = parsed[0];

  // Only held when someone asks for a company invoice. A consumer sale
  // closes on a receipt, which needs none of this.
  const inv = (body.invoice ?? null) as Record<string, unknown> | null;
  const wantsInvoice = !!inv && String(inv.name ?? "").trim().length > 0;

  const { data: order, error: orderErr } = await db
    .from("orders")
    .insert({
      buyer_email: buyerEmail,
      buyer_name: String(body.buyer_name ?? "").slice(0, 200) || null,
      lang: orderLang,
      channel,
      // The single-recipient columns carry the first gift, so everything
      // written against them before this change still reads sensibly.
      recipient_email: first.recipient_email,
      recipient_name: first.recipient_name,
      gift_message: first.gift_message,
      delivery_method: first.delivery_method,
      deliver_at: first.deliver_at,
      gifts,
      items: flatItems,
      gross_cents: gross,
      discount_cents: gross - total,
      total_cents: total,
      vat_rate: vatRate,
      status: "pending",
      invoice_kind: wantsInvoice ? "szamla" : "nyugta",
      invoice_name: wantsInvoice ? trim(inv!.name, 200) : null,
      invoice_tax_number: wantsInvoice ? trim(inv!.tax_number, 40) : null,
      invoice_country: wantsInvoice ? trim(inv!.country, 80) : null,
      invoice_postcode: wantsInvoice ? trim(inv!.postcode, 20) : null,
      invoice_city: wantsInvoice ? trim(inv!.city, 120) : null,
      invoice_address: wantsInvoice ? trim(inv!.address, 200) : null,
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    console.error("order insert failed", orderErr);
    return json({ error: "server_error" }, 500);
  }

  // What the buyer sees on their card statement and Stripe receipt.
  const what = isGift ? "gift voucher" : "ticket";
  const descr = `Balaton Park Circuit ${what} - ${labels.slice(0, 6).join(", ")}` +
    (labels.length > 6 ? ` +${labels.length - 6} more` : "");

  if (ON_PAGE) {
    const { ok, body: intent } = await stripe("payment_intents", {
      amount: total,
      currency,
      receipt_email: buyerEmail,
      description: descr.slice(0, 1000),
      automatic_payment_methods: { enabled: true },
      metadata: { order_id: order.id, gifts: String(gifts.length), channel },
    }, `order_${order.id}`);

    if (!ok || !intent.client_secret) {
      console.error("stripe payment intent failed", intent);
      await db.from("orders").update({ status: "failed" }).eq("id", order.id);
      return json({ error: "payment_setup_failed" }, 502);
    }

    await db.from("orders")
      .update({ stripe_payment_id: intent.id })
      .eq("id", order.id);

    return json({
      order_id: order.id,
      client_secret: intent.client_secret,
      publishable_key: STRIPE_PK,
      return_url: `${siteUrl}/thank-you.html?order=${order.id}`,
      checkout_url: null,
      total_cents: total,
      discount_cents: gross - total,
      currency,
    });
  }

  const stripeLines = flatItems.map((it) => ({
    quantity: it.qty,
    price_data: {
      currency,
      unit_amount: it.unit_cents,
      product_data: { name: `${it.name} - Balaton Park Circuit ${what}` },
    },
  }));

  const { ok, body: session } = await stripe("checkout/sessions", {
    mode: "payment",
    client_reference_id: order.id,
    customer_email: buyerEmail,
    line_items: stripeLines,
    metadata: { order_id: order.id },
    payment_intent_data: { metadata: { order_id: order.id } },
    success_url: `${siteUrl}/thank-you.html?order=${order.id}`,
    cancel_url: `${siteUrl}/purchase.html?cancelled=1`,
  }, `order_${order.id}`);

  if (!ok) {
    console.error("stripe session failed", session);
    await db.from("orders").update({ status: "failed" }).eq("id", order.id);
    return json({ error: "payment_setup_failed" }, 502);
  }

  await db.from("orders")
    .update({ stripe_session_id: session.id })
    .eq("id", order.id);

  return json({
    order_id: order.id,
    client_secret: null,
    publishable_key: null,
    checkout_url: session.url,
    total_cents: total,
    discount_cents: gross - total,
    currency,
  });
});
