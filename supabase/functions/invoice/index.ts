import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Issues the tax document for a paid order through Számlázz.hu's Számla
// Agent, and files the PDF.
//
//   POST { order_id, force? }   with header x-send-token
//
// A consumer buying a gift gets a nyugta, which carries no buyer details at
// all. Only someone who asked for a company invoice gets a számla, and that
// is the one case where a name, an address and a tax number are held.
//
// Prices on this site are VAT inclusive, so each line's gross is the known
// figure and the net and VAT are derived from it. They are derived in that
// order, and the VAT is taken as the remainder, so net + VAT always equals
// the gross the buyer actually paid rather than missing it by a cent.

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const AGENT_KEY = Deno.env.get("SZAMLAZZ_AGENT_KEY");
const ENDPOINT = "https://www.szamlazz.hu/szamla/";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Text going into XML, not HTML: the five predefined entities, nothing else.
const x = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string));

const el = (name: string, value: unknown) => `<${name}>${x(value)}</${name}>`;

/** First match of <name>…</name>, ignoring any namespace prefix. */
function pick(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`));
  return m ? m[1].trim() : "";
}

const money2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  return (v === undefined || v === null ? fallback : v) as T;
}

type Line = { name: string; qty: number; gross: number; net: number; vat: number };

function linesFor(items: Record<string, unknown>[], vatRate: number): Line[] {
  return items.map((it) => {
    const qty = Math.max(1, Number(it.qty ?? 1));
    const gross = Number(it.line_cents ?? 0) / 100;
    // Gross is what was charged. Net is derived from it and VAT is the
    // remainder, so the three always reconcile exactly.
    const net = Math.round((gross / (1 + vatRate)) * 100) / 100;
    return { name: String(it.name ?? "Gift voucher"), qty, gross, net, vat: gross - net };
  });
}

function receiptXml(o: {
  key: string; prefix: string; currency: string; payLabel: string;
  orderId: string; vatPercent: number; lines: Line[]; total: number;
}) {
  const tetel = o.lines.map((l) => `<tetel>
      ${el("megnevezes", l.name)}
      ${el("mennyiseg", l.qty.toFixed(1))}
      ${el("mennyisegiEgyseg", "db")}
      ${el("nettoEgysegar", money2(l.net / l.qty))}
      ${el("afakulcs", String(o.vatPercent))}
      ${el("netto", money2(l.net))}
      ${el("afa", money2(l.vat))}
      ${el("brutto", money2(l.gross))}
    </tetel>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlnyugtacreate xmlns="http://www.szamlazz.hu/xmlnyugtacreate"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.szamlazz.hu/xmlnyugtacreate https://www.szamlazz.hu/szamla/docs/xsds/nyugtacreate/xmlnyugtacreate.xsd">
  <beallitasok>
    ${el("szamlaagentkulcs", o.key)}
    <pdfLetoltes>true</pdfLetoltes>
  </beallitasok>
  <fejlec>
    ${el("hivasAzonosito", o.orderId)}
    ${el("elotag", o.prefix)}
    ${el("fizmod", o.payLabel)}
    ${el("penznem", o.currency)}
    ${el("devizabank", "MNB")}
    <devizaarf>0.0</devizaarf>
    ${el("rendelesSzam", o.orderId)}
  </fejlec>
  <tetelek>${tetel}</tetelek>
  <kifizetesek>
    <kifizetes>
      ${el("fizetoeszkoz", o.payLabel)}
      ${el("osszeg", money2(o.total))}
    </kifizetes>
  </kifizetesek>
</xmlnyugtacreate>`;
}

function invoiceXml(o: {
  key: string; currency: string; payLabel: string; lang: string;
  orderId: string; date: string; vatPercent: number; lines: Line[];
  buyerEmail: string; name: string; postcode: string; city: string;
  address: string; taxNumber: string;
}) {
  const tetel = o.lines.map((l) => `<tetel>
      ${el("megnevezes", l.name)}
      ${el("mennyiseg", l.qty.toFixed(1))}
      ${el("mennyisegiEgyseg", "db")}
      ${el("nettoEgysegar", money2(l.net / l.qty))}
      ${el("afakulcs", String(o.vatPercent))}
      ${el("nettoErtek", money2(l.net))}
      ${el("afaErtek", money2(l.vat))}
      ${el("bruttoErtek", money2(l.gross))}
    </tetel>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
  <beallitasok>
    ${el("szamlaagentkulcs", o.key)}
    <eszamla>true</eszamla>
    <szamlaLetoltes>true</szamlaLetoltes>
    <valaszVerzio>2</valaszVerzio>
  </beallitasok>
  <fejlec>
    ${el("keltDatum", o.date)}
    ${el("teljesitesDatum", o.date)}
    ${el("fizetesiHataridoDatum", o.date)}
    ${el("fizmod", o.payLabel)}
    ${el("penznem", o.currency)}
    ${el("szamlaNyelve", o.lang)}
    ${el("arfolyamBank", "MNB")}
    <arfolyam>0.0</arfolyam>
    ${el("rendelesSzam", o.orderId)}
    <elolegszamla>false</elolegszamla>
    <vegszamla>false</vegszamla>
    <helyesbitoszamla>false</helyesbitoszamla>
    <dijbekero>false</dijbekero>
  </fejlec>
  <elado></elado>
  <vevo>
    ${el("nev", o.name)}
    ${el("irsz", o.postcode)}
    ${el("telepules", o.city)}
    ${el("cim", o.address)}
    ${el("email", o.buyerEmail)}
    <sendEmail>false</sendEmail>
    ${o.taxNumber ? el("adoszam", o.taxNumber) : ""}
  </vevo>
  <tetelek>${tetel}</tetelek>
</xmlszamla>`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { data: tok } = await db.from("settings").select("value").eq("key", "send_token").maybeSingle();
  const expected = typeof tok?.value === "string" ? tok.value : JSON.stringify(tok?.value ?? "").replace(/"/g, "");
  if (!expected || req.headers.get("x-send-token") !== expected) return json({ error: "forbidden" }, 403);

  if (!AGENT_KEY) return json({ error: "agent_key_not_configured" }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const orderId = String(body.order_id ?? "");

  const { data: order } = await db.from("orders")
    .select("id, status, paid_at, buyer_name, buyer_email, items, total_cents, vat_rate, lang, " +
            "invoice_kind, invoice_name, invoice_tax_number, invoice_country, invoice_postcode, " +
            "invoice_city, invoice_address, invoice_number, invoice_url")
    .eq("id", orderId).maybeSingle();

  if (!order) return json({ error: "order_not_found" }, 404);
  if (order.status !== "paid") return json({ error: "order_not_paid" }, 409);
  // Already issued. Never ask the tax authority for a second document.
  if (order.invoice_number && !body.force) {
    return json({ ok: true, already: true, number: order.invoice_number });
  }

  const wantsInvoice = order.invoice_kind === "szamla";
  const vatRate = Number(order.vat_rate ?? 0.27);
  const vatPercent = Math.round(vatRate * 100);
  const currency = (await setting<string>("currency", "eur")).toUpperCase();
  const payLabel = await setting<string>("invoice_payment_label", "bankkártya");
  const prefix = await setting<string>("nyugta_prefix", "NYUGTA");

  const items = Array.isArray(order.items) ? order.items as Record<string, unknown>[] : [];
  if (!items.length) return json({ error: "order_has_no_items" }, 400);
  const lines = linesFor(items, vatRate);
  const total = Number(order.total_cents ?? 0) / 100;
  const date = String(order.paid_at ?? new Date().toISOString()).slice(0, 10);

  const xml = wantsInvoice
    ? invoiceXml({
      key: AGENT_KEY, currency, payLabel,
      lang: order.lang === "hu" ? "hu" : "en",
      orderId: String(order.id), date, vatPercent, lines,
      buyerEmail: String(order.buyer_email ?? ""),
      name: String(order.invoice_name ?? order.buyer_name ?? ""),
      postcode: String(order.invoice_postcode ?? ""),
      city: String(order.invoice_city ?? ""),
      address: String(order.invoice_address ?? ""),
      taxNumber: String(order.invoice_tax_number ?? ""),
    })
    : receiptXml({
      key: AGENT_KEY, prefix, currency, payLabel,
      orderId: String(order.id), vatPercent, lines, total,
    });

  const form = new FormData();
  form.append(
    wantsInvoice ? "action-xmlagentxmlfile" : "action-szamla_agent_nyugta_create",
    new Blob([xml], { type: "application/xml" }),
    "request.xml",
  );

  const res = await fetch(ENDPOINT, { method: "POST", body: form });
  const text = await res.text();

  const headerErr = res.headers.get("szlahu_error");
  const sikeres = pick(text, "sikeres");
  const failed = !res.ok || sikeres === "false" || !!headerErr;

  if (failed) {
    const message = (pick(text, "hibauzenet") || (headerErr ? decodeURIComponent(headerErr) : "") ||
      text.slice(0, 300)).slice(0, 500);
    const code = pick(text, "hibakod") || res.headers.get("szlahu_error_code") || String(res.status);
    console.error("szamlazz refused", code, message);
    await db.from("orders").update({ invoice_error: `${code}: ${message}` }).eq("id", orderId);
    return json({ error: "szamlazz_failed", code, message }, 502);
  }

  const number = wantsInvoice ? pick(text, "szamlaszam") : pick(text, "nyugtaszam");
  const pdfB64 = (wantsInvoice ? pick(text, "pdf") : pick(text, "nyugtaPdf")).replace(/\s+/g, "");

  let stored: string | null = null;
  if (pdfB64) {
    try {
      const bin = Uint8Array.from(atob(pdfB64), (c) => c.charCodeAt(0));
      const key = `${orderId}/${(number || "document").replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`;
      const { error } = await db.storage.from("invoices")
        .upload(key, bin, { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(error.message);
      stored = key;
    } catch (e) {
      console.error("pdf store failed", e);
    }
  }

  await db.from("orders").update({
    invoice_kind: wantsInvoice ? "szamla" : "nyugta",
    invoice_number: number || null,
    invoice_url: stored,
    invoiced_at: new Date().toISOString(),
    invoice_error: null,
  }).eq("id", orderId);

  return json({ ok: true, kind: wantsInvoice ? "szamla" : "nyugta", number, stored });
});
