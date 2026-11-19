import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import qrcode from "npm:qrcode-generator@1.4.4";

// Sends one voucher or ticket: renders its artwork, puts the PNG somewhere an
// email client will load it from, and mails it in the language chosen for it.
//
//   POST { order_id, gift_index, to? }  with header x-send-token
//
// The token lives in the settings table, so this cannot be fired from the
// open internet and no key has to travel anywhere to set it up.
//
// Neither the artwork nor the wording is duplicated here. ticket.js and
// email-copy.json ON THE ORDER'S OWN SITE are the one definition of each,
// fetched at cold start, so changing either is a push rather than a redeploy.
// Which site that is comes from orders.channel: a gift order reads the gift
// shop's files and sends gifting wording, a self-purchase reads the
// experience shop's and sends ticket wording. Push the static site before
// deploying this, or the first cold start of a channel has nothing to fetch.

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const RESEND = Deno.env.get("RESEND_API_KEY");
// One verified sender for both shops. Changing the self one to tickets@ is a
// single line here, but only once that mailbox is verified in Resend - an
// unverified From bounces every send.
const FROM = "Balaton Park Circuit <gifts@balatonpark.com>";
const REPLY_TO = "info@balatonparkcircuit.com";
const INK = "#0A1422";
// Wide enough to stay crisp on a high-density phone screen at the 536px the
// email shows it at, small enough that several tickets fit in one worker.
const TICKET_PX = 1200;

// What differs between the two shops, in one place. The ticket face is one
// design in both languages, with only its eyebrow bilingual, so a Hungarian
// order and an English one look like the same thing.
type Chan = {
  site: string;
  label: string;
  isGift: boolean;
  claimPath: string;
  eyebrow: string;
  codeLabel: string;
  scan: string;
  foot: (isExperience: boolean) => string;
};

const CHANNELS: Record<string, Chan> = {
  gift: {
    site: "https://gifts.balatonpark.com",
    label: "Gifts.BalatonPark.com",
    isGift: true,
    claimPath: "redeem.html",
    eyebrow: "GIFT VOUCHER · AJÁNDÉKUTALVÁNY",
    codeLabel: "VOUCHER CODE",
    scan: "SCAN TO REDEEM",
    foot: (isExperience) =>
      isExperience
        ? "Arrange your date at gifts.balatonpark.com · valid for 2027"
        : "Redeem at gifts.balatonpark.com · valid for the 2027 season",
  },
  self: {
    site: "https://experience.balatonpark.com",
    label: "Experience.BalatonPark.com",
    isGift: false,
    claimPath: "register.html",
    eyebrow: "TICKET · BELÉPŐJEGY",
    codeLabel: "TICKET CODE",
    scan: "SCAN TO REGISTER",
    foot: (isExperience) =>
      isExperience
        ? "Dates published in January · valid for the 2027 season"
        : "Register at experience.balatonpark.com · valid for the 2027 season",
  },
};

const chanOf = (v: unknown) => CHANNELS[String(v ?? "gift")] ?? CHANNELS.gift;

const FONTS = [
  "https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B47b1_3E.ttf",
  "https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8L6tjPQ.ttf",
  "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf",
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

type Copy = Record<string, Record<string, string>>;
type Renderer = (o: Record<string, unknown>) => string;

// The wasm renderer and the fonts are the same whichever shop sold it, so
// they are set up once for the worker.
let engine: Promise<Uint8Array[]> | null = null;
function ready(): Promise<Uint8Array[]> {
  if (!engine) {
    const pending = (async () => {
      const wasm = await fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm");
      await initWasm(await wasm.arrayBuffer());
      return await Promise.all(FONTS.map(async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`font ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      }));
    })();
    // Same reasoning as siteFiles below: a cached rejection would poison
    // every later send from this worker.
    pending.catch(() => { if (engine === pending) engine = null; });
    engine = pending;
  }
  return engine;
}

// The artwork and the wording, per shop, each fetched once per worker.
//
// A failure is NOT cached. A promise that rejected would otherwise be handed
// to every later send from the same worker, so one shop being briefly
// unreachable - a Pages deploy mid-flight, a 404 before the site is switched
// on - would keep failing long after it came back. Dropping the entry means
// the next send fetches again.
const sites: Record<string, Promise<{ ticket: Renderer; copy: Copy }>> = {};
function siteFiles(ch: Chan) {
  if (!sites[ch.site]) {
    const pending = (async () => {
      const src = await fetch(`${ch.site}/ticket.js`).then((r) => {
        if (!r.ok) throw new Error(`ticket.js ${r.status}`);
        return r.text();
      });
      const scope: Record<string, unknown> = {};
      new Function("window", src)(scope);
      const ticket = scope.bpcTicket as Renderer;
      if (typeof ticket !== "function") throw new Error("ticket.js did not define bpcTicket");
      const copy = await fetch(`${ch.site}/email-copy.json`).then((r) => {
        if (!r.ok) throw new Error(`email-copy ${r.status}`);
        return r.json();
      }) as Copy;
      return { ticket, copy };
    })();
    pending.catch(() => {
      if (sites[ch.site] === pending) delete sites[ch.site];
    });
    sites[ch.site] = pending;
  }
  return sites[ch.site];
}

/** One string in one language, with {placeholders} filled in. */
function say(copy: Copy, lg: string, key: string, vars?: Record<string, unknown>) {
  const s = (copy[lg] ?? {})[key] ?? (copy.en ?? {})[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] === undefined ? m : String(vars[n])));
}

function qrFor(ch: Chan, code: string) {
  const q = qrcode(0, "M");
  q.addData(`${ch.site}/${ch.claimPath}?code=${code}`);
  q.make();
  const n = q.getModuleCount();
  let rects = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) {
        rects += `<rect x="${c}" y="${r}" width="1.06" height="1.06" rx="0.2"/>`;
      }
    }
  }
  return { rects, modules: n };
}

async function renderTicket(ch: Chan, v: Record<string, unknown>) {
  const fonts = await ready();
  const { ticket } = await siteFiles(ch);
  const sessions = Number(v.sessions_total ?? 1);
  const isVip = v.package_code === "vip";
  // An experience is not measured in sessions, so its ticket names the
  // programme where a session voucher names a count, and the stub carries
  // its two letters.
  const mark = typeof v.ticket_mark === "string" && v.ticket_mark ? v.ticket_mark : null;
  const isExperience = !!mark && !isVip;
  const name = String(v.package_name ?? "").toUpperCase();
  const qr = qrFor(ch, String(v.code));
  const svg = ticket({
    code: v.code,
    shortCode: String(v.code).replace(/^BPC-/, ""),
    sessions: isExperience ? mark : (isVip ? "VIP" : sessions),
    headline: isExperience
      ? name
      : (isVip ? "VIP DAY" : (sessions > 1 ? `${sessions} SESSIONS` : "ONE SESSION")),
    sub: isExperience ? "BALATON PARK CIRCUIT" : "ON TRACK AT BALATON PARK",
    eyebrow: ch.eyebrow,
    codeLabel: ch.codeLabel,
    footnote: ch.foot(isExperience),
    admit: "ADMIT ONE",
    unit: isExperience ? "PLACE" : (isVip ? "DAY" : (sessions > 1 ? "SESSIONS" : "SESSION")),
    each: isExperience ? "ONE PERSON" : (isVip ? "SIX SESSIONS" : "25 MINUTES EACH"),
    scanLabel: ch.scan,
    qr: qr.rects,
    qrModules: qr.modules,
  });

  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: TICKET_PX },
    font: { fontBuffers: fonts, defaultFontFamily: "Barlow Condensed", loadSystemFonts: false },
  });
  const img = r.render();
  const png = img.asPng();
  // The wasm heap is not garbage collected. Without these, each ticket leaks
  // its pixel buffer and an order holding two vouchers kills the worker.
  try { img.free(); r.free(); } catch { /* older build without free() */ }
  return png;
}

async function hostTicket(code: string, png: Uint8Array) {
  const key = `${code}-${crypto.randomUUID().slice(0, 8)}.png`;
  const { error } = await db.storage.from("tickets")
    .upload(key, png, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  const { data } = db.storage.from("tickets").getPublicUrl(key);
  return data.publicUrl;
}

function emailHtml(o: {
  ch: Chan; copy: Copy; lg: string;
  recipient: string; buyer: string; message: string | null;
  tickets: { url: string; code: string; sessions: number }[];
}) {
  const T = (k: string, v?: Record<string, unknown>) => say(o.copy, o.lg, k, v);
  const ch = o.ch;
  const to = o.recipient ? esc(o.recipient) : "";
  const from = o.buyer ? esc(o.buyer) : "";
  // The band's own background is this same ink on every frame, so there is
  // no edge between the animation and the message around it. The filename
  // carries a number because caching proxies key on the URL, and a changed
  // file at the same name keeps serving the old frames.
  //
  // A gift is an occasion and opens on it. A ticket somebody bought for
  // themselves is not, so that shop opens on the wording instead.
  const party = ch.isGift
    ? `<tr><td style="padding:0;line-height:0">
         <img src="${ch.site}/celebrate-2.gif" width="600" alt=""
              style="display:block;width:100%;max-width:600px;height:auto;border:0">
       </td></tr>`
    : "";

  const blocks = o.tickets.map((t) => `
    <tr><td style="padding:0 0 16px">
      <img src="${t.url}" width="536" alt="Balaton Park Circuit ${esc(t.code)}"
           style="display:block;width:100%;max-width:536px;height:auto;border:0">
    </td></tr>
    <tr><td style="padding:0 0 34px;text-align:center">
      <a href="${ch.site}/${ch.claimPath}?code=${encodeURIComponent(t.code)}"
         style="display:inline-block;background:#427AB7;color:#ffffff;text-decoration:none;
                font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;
                letter-spacing:1.5px;padding:18px 40px">${T("g.redeem")}</a>
      <div style="margin-top:11px;font-family:Arial,Helvetica,sans-serif;font-size:12px;
                  color:rgba(245,247,251,0.45)">${T("g.scanHint")}</div>
    </td></tr>`).join("");

  // Only a gift carries a message, and only a gift names who it is from.
  const note = o.message
    ? `<tr><td style="padding:0 0 34px">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                style="background:#14202F;border:1px solid #6A5520">
           <tr><td style="padding:22px 26px;text-align:center">
             <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;
                         letter-spacing:3px;color:#E2C254;text-transform:uppercase">${T("g.messageTitle")}</div>
             <div style="margin-top:13px;font-family:Georgia,'Times New Roman',serif;font-size:18px;
                         line-height:1.6;color:#F3E6BE;font-style:italic">${esc(o.message)}</div>
             ${from && ch.isGift ? `<div style="margin-top:13px;font-family:Arial,Helvetica,sans-serif;
                         font-size:12px;letter-spacing:2px;color:#B9933A;text-transform:uppercase">
                         - ${from}</div>` : ""}
           </td></tr>
         </table></td></tr>`
    : "";

  const fact = (h: string, p: string) => `
    <td width="50%" valign="top" style="padding:0 10px">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;
                  letter-spacing:2px;color:#E2C254;text-transform:uppercase">${h}</div>
      <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;
                  line-height:1.65;color:rgba(245,247,251,0.72)">${p}</div>
    </td>`;

  // A gift says who it is from; a self-purchase has nobody to name.
  const lede = ch.isGift
    ? (from ? T("g.lede", { buyer: from }) : T("g.ledeAnon"))
    : T("g.lede");

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${T("g.preheader")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK}">
<tr><td align="center" style="padding:0 0 10px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0"
         style="width:100%;max-width:600px;background:${INK}">

    ${party}

    <tr><td style="padding:${ch.isGift ? "4px" : "34px"} 28px 32px;text-align:center">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;
                  letter-spacing:5px;color:#E2C254;text-transform:uppercase">✦ &nbsp;${T("g.eyebrow")}&nbsp; ✦</div>
      <h1 style="margin:14px 0 0;font-family:Arial Black,Arial,Helvetica,sans-serif;font-size:31px;
                 line-height:1.15;color:#ffffff;letter-spacing:-0.5px">
        ${to ? T("g.h1", { name: to }) : T("g.h1Anon")}
      </h1>
      <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;
                line-height:1.65;color:rgba(245,247,251,0.82)">
        ${lede}
      </p>
    </td></tr>

    <tr><td style="padding:0 32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${blocks}
        ${note}
        <tr><td style="padding:0 0 30px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border-top:1px solid rgba(255,255,255,0.12)"><tr><td style="padding:26px 0 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              ${fact(T("g.whatH"), T("g.whatP"))}
              ${fact(T("g.whereH"), T("g.whereP"))}
            </tr></table>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:0 0 32px">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;
                      letter-spacing:2px;color:#E2C254;text-transform:uppercase">${T("g.howH")}</div>
          <div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;
                      line-height:1.85;color:rgba(245,247,251,0.72)">
            <strong style="color:#A8CEF0">1.</strong> ${T("g.how1")}<br>
            <strong style="color:#A8CEF0">2.</strong> ${T("g.how2")}<br>
            <strong style="color:#A8CEF0">3.</strong> ${T("g.how3")}
          </div>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:20px 28px 30px;border-top:1px solid rgba(255,255,255,0.12);
                   font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.8;
                   color:rgba(245,247,251,0.5);text-align:center">
      ${T("g.footReply")}<br>
      <a href="${ch.site}/faq.html" style="color:#A8CEF0;text-decoration:none">${T("g.footFaq")}</a>
      &nbsp;&middot;&nbsp;
      <a href="${ch.site}" style="color:#A8CEF0;text-decoration:none">${ch.label}</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!RESEND) return json({ error: "resend_not_configured" }, 503);

  const { data: tok } = await db.from("settings").select("value").eq("key", "send_token").maybeSingle();
  const expected = typeof tok?.value === "string" ? tok.value : JSON.stringify(tok?.value ?? "").replace(/"/g, "");
  if (!expected || req.headers.get("x-send-token") !== expected) {
    return json({ error: "forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const orderId = String(body.order_id ?? "");
  const giftIndex = Number(body.gift_index ?? 0);
  const override = body.to ? String(body.to) : null;

  const { data: order, error: oErr } = await db
    .from("orders")
    .select("id, status, buyer_name, buyer_email, gifts, lang, recipient_name, recipient_email, gift_message, channel")
    .eq("id", orderId)
    .maybeSingle();

  if (oErr) return json({ error: "server_error" }, 500);
  if (!order) return json({ error: "order_not_found" }, 404);
  if (order.status !== "paid") return json({ error: "order_not_paid", status: order.status }, 409);

  const ch = chanOf(order.channel);

  const giftsArr = Array.isArray(order.gifts) && order.gifts.length
    ? order.gifts as Record<string, unknown>[]
    : [{
      recipient_name: order.recipient_name,
      recipient_email: order.recipient_email,
      gift_message: order.gift_message,
      lang: order.lang,
    }];
  const gift = giftsArr[giftIndex];
  if (!gift) return json({ error: "gift_not_found" }, 404);

  const { data: vouchers, error: vErr } = await db
    .from("vouchers")
    .select("id, code, sessions_total, gift_index, packages ( code, name, ticket_mark )")
    .eq("order_id", orderId)
    .order("created_at");

  if (vErr) return json({ error: "server_error" }, 500);

  const mine = (vouchers ?? []).filter((v) =>
    (typeof v.gift_index === "number" ? v.gift_index : 0) === giftIndex
  );
  if (!mine.length) return json({ error: "no_vouchers_for_gift" }, 404);

  // One at a time. Rendering in parallel holds every pixel buffer at once,
  // which is what ran the worker out of memory on a two-voucher gift.
  const tickets: { url: string; code: string; sessions: number }[] = [];
  try {
    for (const v of mine) {
      const pk = v.packages as
        { code?: string; name?: string; ticket_mark?: string } | null;
      const png = await renderTicket(ch, {
        code: v.code,
        sessions_total: v.sessions_total,
        package_code: pk?.code ?? "",
        package_name: pk?.name ?? "",
        ticket_mark: pk?.ticket_mark ?? null,
      });
      tickets.push({
        url: await hostTicket(String(v.code), png),
        code: String(v.code),
        sessions: Number(v.sessions_total ?? 1),
      });
    }
  } catch (e) {
    console.error("ticket render failed", e);
    return json({ error: "render_failed", detail: String(e) }, 500);
  }

  const to = override ?? String(gift.recipient_email ?? "");
  if (!to) return json({ error: "no_recipient" }, 400);

  const { copy } = await siteFiles(ch);
  // The receiver's own choice wins; the buyer's language is the fallback.
  const lg = String(gift.lang ?? order.lang ?? "en") === "hu" ? "hu" : "en";
  const buyerName = String(order.buyer_name ?? "");

  const html = emailHtml({
    ch, copy, lg,
    recipient: String(gift.recipient_name ?? ""),
    buyer: buyerName,
    message: (gift.gift_message as string) ?? null,
    tickets,
  });

  const subject = buyerName && ch.isGift
    ? say(copy, lg, "g.subject", { buyer: buyerName })
    : say(copy, lg, ch.isGift ? "g.subjectAnon" : "g.subject", { buyer: buyerName });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html }),
  });

  const out = await res.json().catch(() => ({}));

  // email_log's own column names are to_address and template. The template
  // stays "gift" on both shops: order-status reads it to know whether the
  // copy has actually gone out, and renaming it would make every order
  // written before today look unsent.
  const { error: logErr } = await db.from("email_log").insert({
    order_id: orderId,
    voucher_id: mine[0]?.id ?? null,
    gift_index: giftIndex,
    to_address: to,
    template: "gift",
    status: res.ok ? "sent" : "failed",
    provider_id: res.ok ? (out.id ?? null) : null,
    error: res.ok ? null : JSON.stringify(out).slice(0, 500),
  });
  if (logErr) console.error("email_log insert failed", logErr);

  if (!res.ok) {
    console.error("resend failed", out);
    return json({ error: "send_failed", detail: out }, 502);
  }
  return json({ sent: true, to, lang: lg, channel: order.channel ?? "gift", id: out.id, logged: !logErr, tickets: tickets.map((t) => t.url) });
});
