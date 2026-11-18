import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// What the public pages are allowed to know: which packages are on sale,
// their full-price value, the session ladder, the published track days, and
// the publishable Stripe key.
//
// The shop reads its prices from here rather than carrying its own copy, so a
// price changed in the database changes on the site. It is still only for
// display - the checkout function recalculates everything server-side, so a
// tampered page cannot buy a 348 EUR voucher for one cent.

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Publishable by design: it identifies the account to Stripe.js and can do
// nothing on its own. Served here so the card form can be drawn before any
// order exists.
const STRIPE_PK = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const [packages, tiers, days, settings] = await Promise.all([
    db.from("packages")
      .select("code, name, price_cents, list_price_cents, session_count, includes_room, splittable")
      .eq("sellable", true).eq("active", true)
      .order("sort_order"),
    db.from("discount_tiers").select("min_sessions, percent, unit_cents").order("min_sessions"),
    db.from("track_days")
      .select("id, event_date, public_label")
      .eq("status", "published").order("event_date"),
    db.from("settings").select("key, value").in("key", ["currency", "vat_rate"]),
  ]);

  if (packages.error || tiers.error || days.error) {
    console.error("catalogue read failed", packages.error ?? tiers.error ?? days.error);
    return new Response(JSON.stringify({ error: "server_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const setting: Record<string, unknown> = {};
  for (const row of settings.data ?? []) setting[row.key] = row.value;

  return new Response(JSON.stringify({
    packages: packages.data ?? [],
    tiers: (tiers.data ?? []).filter((t: { min_sessions: number | null }) => t.min_sessions),
    session_price_cents: 6500,
    track_days: days.data ?? [],
    currency: setting.currency ?? "eur",
    vat_rate: setting.vat_rate ?? 0.27,
    stripe_publishable_key: STRIPE_PK.startsWith("pk_") ? STRIPE_PK : null,
    // Lets the site say plainly which mode it is in, so a test key in
    // production is visible rather than silent.
    stripe_mode: STRIPE_PK.startsWith("pk_live") ? "live"
      : STRIPE_PK.startsWith("pk_test") ? "test" : "unset",
  }), {
    headers: {
      "Content-Type": "application/json",
      // Prices change rarely; a minute of staleness is cheaper than a
      // round trip on every page load.
      "Cache-Control": "public, max-age=60",
      ...CORS,
    },
  });
});
