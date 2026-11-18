import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// One page view, counted.
//
//   POST { page, ref? }
//
// Exists because the landing page and the FAQ never call a server of ours,
// so every figure we had measured only the people who already reached the
// shop. This sees the whole site.
//
// No cookie is set and no address is stored. The visitor key is a SHA-256
// of the address salted with the day and a server secret, worked out here
// and never written down in raw form: enough to count a person once within
// a day, useless for following them between days or across sites. That is
// why it runs for everyone rather than behind the consent bar, which
// guards the third-party trackers that do follow people.

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Never leaves the server, and rotates the hash daily by being combined
// with the date.
const SALT = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "salt";

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

// A closed list, so a tampered body cannot fill the column with free text.
const PAGES = ["home", "purchase", "faq", "redeem", "thanks", "other"];

// Which header carries the country depends on what is in front of the
// function, and it has changed before. Try the ones that exist in the wild
// rather than trusting one and silently recording nothing.
const COUNTRY_HEADERS = [
  "cf-ipcountry",
  "x-country",
  "x-geo-country",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
  "x-client-geo-country",
];

function countryOf(req: Request): string {
  for (const h of COUNTRY_HEADERS) {
    const v = (req.headers.get(h) ?? "").trim().toUpperCase();
    if (v && v.length === 2 && v !== "XX") return v;
  }
  return "??";
}

function channelOf(ua: string, ref: string): string {
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV/i.test(ua)) return "facebook";
  if (!ref) return "direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (/^(gifts\.)?balatonpark(circuit)?\.com$/i.test(host)) return "direct";
    if (/instagram\.com$/i.test(host)) return "instagram";
    if (/facebook\.com$/i.test(host)) return "facebook";
    if (/(google|bing|duckduckgo|yandex|ecosia)\./i.test(host)) return "search";
    if (/(chatgpt|openai|perplexity|claude)\./i.test(host)) return "ai";
    return "referral";
  } catch {
    return "direct";
  }
}

async function visitorHash(ip: string, day: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ip}|${day}|${SALT}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // A beacon that arrives malformed is still a visit; it just loses its page.
  }

  const ua = req.headers.get("user-agent") ?? "";
  // Crawlers are not visitors, and counting them would quietly inflate every
  // figure on the Traffic tab.
  if (/bot|crawler|spider|HeadlessChrome|curl|wget|preview/i.test(ua)) {
    return json({ ok: true, counted: false });
  }

  const page = PAGES.includes(String(body.page ?? "")) ? String(body.page) : "other";
  const ref = String(body.ref ?? "").slice(0, 500);
  const country = countryOf(req);
  const ip = req.headers.get("cf-connecting-ip") ??
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ?? "";

  const day = new Date().toISOString().slice(0, 10);

  const { error } = await db.from("traffic_hits").insert({
    day,
    page,
    country,
    is_mobile: /Mobile|Android|iPhone|iPad/i.test(ua),
    channel: channelOf(ua, ref),
    visitor_hash: await visitorHash(ip, day),
  });

  if (error) {
    console.error("hit insert failed", error);
    // Still a 200: a counting failure is never the visitor's problem.
    return json({ ok: false });
  }

  // The country is echoed back because it is the one field the page cannot
  // work out for itself, which makes a silent geo failure visible.
  return json({ ok: true, counted: true, country });
});
