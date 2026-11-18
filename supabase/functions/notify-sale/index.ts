import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The two emails around a sale: the buyer's receipt, in the language they
// bought in and carrying their tax document, and the circuit's own
// notification, which stays in English because only the circuit reads it.
//
//   POST { order_id, kind: "sale" | "receipt", to? }   with header x-send-token
//   POST { check: "<resend id>" }                      delivery state of one send
//
// Wording lives in email-copy.json on the site, fetched at cold start, so a
// change to it is a push rather than a redeploy.

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const RESEND = Deno.env.get("RESEND_API_KEY");
const SITE = "https://gifts.balatonpark.com";
const FROM = "Balaton Park Circuit <gifts@balatonpark.com>";
const REPLY_TO = "info@balatonparkcircuit.com";
const SALES_INBOX = "info@balatonparkcircuit.com";
const LOGO = `${SITE}/email-logo.png`;

const INK = "#0A1422";
const CARD = "#101D2E";
const BLUE = "#427AB7";
const PALE = "#A8CEF0";
const LINE = "rgba(255,255,255,0.12)";
const DIM = "rgba(245,247,251,0.62)";
const BODY = "rgba(245,247,251,0.82)";
const SANS = "Arial,Helvetica,sans-serif";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// No cents anywhere on this product, so none here either.
const money = (c: number) => {
  const n = (Number(c) || 0) / 100;
  return "€" + (n % 1 ? n.toFixed(2) : String(Math.round(n)));
};

const firstName = (s: unknown) => String(s ?? "").trim().split(/\s+/)[0] || "";

type Copy = Record<string, Record<string, string>>;
let copyCache: Promise<Copy> | null = null;
function copyFile(): Promise<Copy> {
  if (!copyCache) {
    copyCache = fetch(`${SITE}/email-copy.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})) as Promise<Copy>;
  }
  return copyCache;
}
function say(copy: Copy, lg: string, key: string, vars?: Record<string, unknown>) {
  const s = (copy[lg] ?? {})[key] ?? (copy.en ?? {})[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] === undefined ? m : String(vars[n])));
}

const locale = (lg: string) => (lg === "hu" ? "hu-HU" : "en-GB");

const longDate = (v: unknown, lg: string) => {
  const d = new Date(String(v ?? ""));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale(lg), { day: "numeric", month: "long", year: "numeric" });
};

const shortDateTime = (v: unknown, lg = "en") => {
  const d = new Date(String(v ?? ""));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(locale(lg), {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Budapest",
  });
};

type Gift = Record<string, unknown>;

function deliveryLine(g: Gift, copy: Copy, lg: string) {
  const how = String(g.delivery_method ?? "now");
  if (how === "scheduled") {
    const when = shortDateTime(g.deliver_at, lg);
    return when ? say(copy, lg, "r.sendOn", { when }) : say(copy, lg, "r.sendOn", { when: "" });
  }
  if (how === "print") return say(copy, lg, "r.sendPrint");
  return say(copy, lg, "r.sendNow");
}

// ---------------------------------------------------------------- building

const rule = `<div style="height:3px;width:56px;background:${BLUE};font-size:0;line-height:0">&nbsp;</div>`;

function eyebrow(text: string) {
  return `<div style="font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:4px;
    text-transform:uppercase;color:${PALE}">${text}</div>`;
}

/** One receiver and what they are getting. */
function giftCard(g: Gift, i: number, many: boolean, copy: Copy, lg: string) {
  const items = (g.items as Record<string, unknown>[] ?? []).map((it) => `
    <tr>
      <td style="padding:5px 0;font-family:${SANS};font-size:14px;color:${BODY}">
        ${Number(it.qty) > 1 ? `${esc(it.qty)} &times; ` : ""}${esc(it.name)}
      </td>
      <td align="right" style="padding:5px 0;font-family:${SANS};font-size:14px;
        color:#ffffff;white-space:nowrap">${money(Number(it.line_cents))}</td>
    </tr>`).join("");

  const name = esc(String(g.recipient_name ?? "")) || say(copy, lg, "r.unnamed");
  const mail = esc(String(g.recipient_email ?? ""));

  return `<tr><td style="padding:0 0 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:${CARD};border:1px solid ${LINE}">
      <tr><td style="padding:20px 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:${SANS};font-size:17px;font-weight:bold;color:#ffffff">
              ${many ? `<span style="color:${PALE}">${i + 1}.</span> ` : ""}${name}
            </td>
            <td align="right" style="font-family:${SANS};font-size:11px;font-weight:bold;
              letter-spacing:2px;text-transform:uppercase;color:${PALE};white-space:nowrap">
              ${esc(deliveryLine(g, copy, lg))}
            </td>
          </tr>
          ${mail ? `<tr><td colspan="2" style="padding-top:3px;font-family:${SANS};
            font-size:13px;color:${DIM}">${mail}</td></tr>` : ""}
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin-top:14px;border-top:1px solid ${LINE}">
          <tr><td colspan="2" style="height:10px;font-size:0;line-height:0">&nbsp;</td></tr>
          ${items}
        </table>
      </td></tr>
    </table></td></tr>`;
}

function shell(o: {
  eyebrowText: string; title: string; lede: string; body: string;
  footReply: string; footFaq: string;
}) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK}">
<tr><td align="center" style="padding:34px 16px 40px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">

    <tr><td style="padding:0 0 30px">
      <img src="${LOGO}" width="196" alt="Balaton Park Circuit"
           style="display:block;width:196px;max-width:60%;height:auto;border:0">
    </td></tr>

    <tr><td style="padding:0 0 26px">
      ${rule}
      <div style="height:16px;font-size:0;line-height:0">&nbsp;</div>
      ${eyebrow(o.eyebrowText)}
      <h1 style="margin:12px 0 0;font-family:${SANS};font-size:30px;line-height:1.15;
                 font-weight:bold;color:#ffffff;letter-spacing:-0.4px">${o.title}</h1>
      <p style="margin:13px 0 0;font-family:${SANS};font-size:16px;line-height:1.65;
                color:${BODY}">${o.lede}</p>
    </td></tr>

    <tr><td>${o.body}</td></tr>

    <tr><td style="padding:30px 0 0;border-top:1px solid ${LINE}">
      <div style="font-family:${SANS};font-size:12px;line-height:1.9;color:rgba(245,247,251,0.5)">
        ${o.footReply}<br>
        <a href="${SITE}/faq.html" style="color:${PALE};text-decoration:none">${o.footFaq}</a>
        &nbsp;&middot;&nbsp;
        <a href="${SITE}" style="color:${PALE};text-decoration:none">Gifts.BalatonPark.com</a>
      </div>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function totalRow(label: string, amount: number) {
  return `<tr><td style="padding:6px 0 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border-top:2px solid ${BLUE}">
      <tr>
        <td style="padding:16px 2px;font-family:${SANS};font-size:12px;font-weight:bold;
          letter-spacing:3px;text-transform:uppercase;color:${PALE}">${label}</td>
        <td align="right" style="padding:16px 2px;font-family:${SANS};font-size:26px;
          font-weight:bold;color:#ffffff;white-space:nowrap">${money(amount)}</td>
      </tr>
    </table></td></tr>`;
}

function metaRow(pairs: [string, string][]) {
  const cells = pairs.filter(([, v]) => v).map(([k, v]) => `
    <td valign="top" style="padding:0 18px 0 0">
      <div style="font-family:${SANS};font-size:10px;font-weight:bold;letter-spacing:2px;
        text-transform:uppercase;color:rgba(245,247,251,0.45)">${k}</div>
      <div style="margin-top:5px;font-family:${SANS};font-size:14px;color:${BODY}">${v}</div>
    </td>`).join("");
  return `<tr><td style="padding:0 0 22px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
}

function steps(heading: string, lines: string[]) {
  const rows = lines.map((l, i) => `
    <tr><td valign="top" style="padding:0 12px 10px 0;font-family:${SANS};font-size:14px;
      font-weight:bold;color:${PALE};white-space:nowrap">${i + 1}.</td>
      <td style="padding:0 0 10px;font-family:${SANS};font-size:14px;line-height:1.6;
      color:${BODY}">${l}</td></tr>`).join("");
  return `<tr><td style="padding:28px 0 0">
    ${eyebrow(heading)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="margin-top:14px">${rows}</table></td></tr>`;
}

/** The tax document, if one was issued and filed, as a Resend attachment. */
async function attachment(order: Record<string, unknown>) {
  const path = String(order.invoice_url ?? "");
  if (!path) return null;
  try {
    const { data, error } = await db.storage.from("invoices").download(path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    let bin = "";
    // chunked: spreading a large array into String.fromCharCode blows the stack
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const name = String(order.invoice_number ?? "document").replace(/[^A-Za-z0-9._-]/g, "-");
    return { filename: `${name}.pdf`, content: btoa(bin) };
  } catch (e) {
    console.error("attachment failed", e);
    return null;
  }
}

// ------------------------------------------------------------------ serve

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!RESEND) return json({ error: "resend_not_configured" }, 503);

  const { data: tok } = await db.from("settings").select("value").eq("key", "send_token").maybeSingle();
  const expected = typeof tok?.value === "string" ? tok.value : JSON.stringify(tok?.value ?? "").replace(/"/g, "");
  if (!expected || req.headers.get("x-send-token") !== expected) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  // Ask the provider what became of a send, for when something never arrives.
  if (body.check) {
    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(String(body.check))}`, {
      headers: { "Authorization": `Bearer ${RESEND}` },
    });
    return json({ status: r.status, record: await r.json().catch(() => ({})) }, r.ok ? 200 : 502);
  }

  const orderId = String(body.order_id ?? "");
  const kind = String(body.kind ?? "sale");
  const override = body.to ? String(body.to) : null;

  const { data: order } = await db.from("orders")
    .select("id, status, buyer_name, buyer_email, gifts, items, total_cents, gross_cents, " +
            "discount_cents, paid_at, lang, invoice_kind, invoice_number, invoice_url, " +
            "recipient_name, recipient_email, delivery_method, deliver_at")
    .eq("id", orderId).maybeSingle();

  if (!order) return json({ error: "order_not_found" }, 404);
  if (order.status !== "paid") return json({ error: "order_not_paid" }, 409);

  const copy = await copyFile();
  // The receipt speaks to the buyer, so it follows the language they bought
  // in. The sale notice speaks to the circuit, and stays in English.
  const lg = kind === "receipt" && String(order.lang ?? "") === "hu" ? "hu" : "en";

  const gifts = (Array.isArray(order.gifts) && order.gifts.length
    ? order.gifts
    : [{
      recipient_name: order.recipient_name, recipient_email: order.recipient_email,
      delivery_method: order.delivery_method, deliver_at: order.deliver_at,
      items: order.items,
    }]) as Gift[];

  const many = gifts.length > 1;
  const cards = gifts.map((g, i) => giftCard(g, i, many, copy, lg)).join("");
  const ref = String(order.id).slice(0, 8).toUpperCase();
  const saved = Number(order.gross_cents ?? 0) - Number(order.total_cents ?? 0);

  let to: string, subject: string, html: string;
  let attach: { filename: string; content: string } | null = null;

  if (kind === "receipt") {
    to = override ?? String(order.buyer_email);
    const who = firstName(order.buyer_name);
    const anyScheduled = gifts.some((g) => g.delivery_method === "scheduled");
    const anyPrint = gifts.some((g) => g.delivery_method === "print");
    const isInvoice = order.invoice_kind === "szamla";

    attach = await attachment(order);

    const next = [
      anyPrint ? say(copy, lg, "r.nextPrint") : say(copy, lg, "r.nextEmail"),
      anyScheduled ? say(copy, lg, "r.nextScheduled") : say(copy, lg, "r.nextPick"),
      say(copy, lg, "r.nextSeason"),
    ];
    if (attach) next.push(say(copy, lg, isInvoice ? "r.attachedInvoice" : "r.attached"));

    subject = say(copy, lg, "r.subject", { ref });
    html = shell({
      eyebrowText: say(copy, lg, "r.eyebrow"),
      title: who ? say(copy, lg, "r.title", { name: esc(who) }) : say(copy, lg, "r.titleAnon"),
      lede: many ? say(copy, lg, "r.ledeMany", { n: gifts.length }) : say(copy, lg, "r.lede"),
      footReply: say(copy, lg, "r.footReply"),
      footFaq: say(copy, lg, "r.footFaq"),
      body:
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
        metaRow([
          [say(copy, lg, "r.metaOrder"), ref],
          [say(copy, lg, "r.metaPaid"), longDate(order.paid_at, lg)],
          [say(copy, lg, many ? "r.metaMany" : "r.metaOne"), String(gifts.length)],
          [say(copy, lg, "r.metaDocument"), esc(String(order.invoice_number ?? ""))],
        ]) +
        cards +
        (saved > 0
          ? `<tr><td align="right" style="padding:4px 2px 0;font-family:${SANS};font-size:13px;
              color:${PALE}">${say(copy, lg, "r.saved", { amount: money(saved) })}</td></tr>`
          : "") +
        totalRow(say(copy, lg, "r.total"), Number(order.total_cents)) +
        steps(say(copy, lg, "r.nextH"), next) +
        `</table>`,
    });
  } else {
    to = override ?? SALES_INBOX;
    subject = `Voucher sale ${money(Number(order.total_cents))}` +
      (many ? ` to ${gifts.length} receivers` : "") + ` (${ref})`;
    html = shell({
      eyebrowText: "New voucher sale",
      title: `${money(Number(order.total_cents))} just came in.`,
      footReply: "",
      footFaq: "Read the FAQ",
      lede: `${esc(String(order.buyer_name ?? "")) || "A buyer"} ` +
        `(<a href="mailto:${esc(String(order.buyer_email ?? ""))}" ` +
        `style="color:${PALE};text-decoration:none">${esc(String(order.buyer_email ?? ""))}</a>) ` +
        `bought ${gifts.length === 1 ? "a gift voucher" : `${gifts.length} gift vouchers`}.`,
      body:
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
        metaRow([
          ["Order", ref],
          ["Paid", shortDateTime(order.paid_at)],
          ["Discount", saved > 0 ? money(saved) : "none"],
          [order.invoice_kind === "szamla" ? "Invoice" : "Receipt",
           esc(String(order.invoice_number ?? "pending"))],
        ]) +
        cards +
        totalRow("Order total", Number(order.total_cents)) +
        `</table>`,
    });
  }

  const payload: Record<string, unknown> = {
    from: FROM, to: [to], reply_to: REPLY_TO, subject, html,
  };
  if (attach) payload.attachments = [attach];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));

  const { error: logErr } = await db.from("email_log").insert({
    order_id: orderId,
    to_address: to,
    template: kind,
    status: res.ok ? "sent" : "failed",
    provider_id: res.ok ? (out.id ?? null) : null,
    error: res.ok ? null : JSON.stringify(out).slice(0, 500),
  });
  if (logErr) console.error("email_log insert failed", logErr);

  if (!res.ok) return json({ error: "send_failed", detail: out }, 502);
  return json({ sent: true, to, kind, lang: lg, attached: !!attach, id: out.id });
});
