import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Records where a buyer says they heard about the vouchers.
//
//   POST { order_id, heard_about }
//
// Deliberately not part of /checkout. This is a marketing signal, and the
// till is the one thing on the site that must never break: a failure here
// has to be survivable, so it lives on its own path and the page fires it
// without waiting for an answer.
//
// The answer is set once, on an order the buyer has just created. It cannot
// overwrite an existing answer, and it cannot reach back to an older order.

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

// A closed set, so nothing a tampered body sends can land in the column as
// free text. Anything unrecognised is refused rather than stored.
const ANSWERS = ["instagram", "facebook", "search", "friend", "been", "other"];

// Long enough to cover a slow card confirmation, short enough that an order
// id leaked later is of no use.
const WINDOW_MS = 2 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const orderId = String(body.order_id ?? "").trim();
  if (!UUID.test(orderId)) return json({ error: "order_id_invalid" }, 400);

  const answer = String(body.heard_about ?? "").trim().toLowerCase();
  if (!ANSWERS.includes(answer)) return json({ error: "answer_invalid" }, 400);

  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data, error } = await db
    .from("orders")
    .update({ heard_about: answer })
    .eq("id", orderId)
    .is("heard_about", null)
    .gte("created_at", since)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("attribution update failed", error);
    return json({ error: "server_error" }, 500);
  }

  // No row means the order is too old, already answered, or not ours. None
  // of those is worth an error on the buyer's screen.
  return json({ ok: true, recorded: !!data });
});
