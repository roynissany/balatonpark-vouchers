# Server side

The site in the repo root is only half the system. The other half runs on
Supabase and, until 18 November 2026, existed **nowhere but there**: no copy in
this repo, no copy on anyone's machine. Losing the Supabase project would have
taken the checkout, the webhook, redemption, invoicing and every email with it.

This folder is that missing copy.

## What is here

| Path | What it is |
|---|---|
| `functions/<name>/index.ts` | All 12 edge functions that matter, as deployed |
| `schema/functions.sql` | Every database function, including the ones that move money |
| `schema/tables.sql` | Tables, columns, views and the scheduled jobs |

The twelve, and what each one is for:

| Function | What it does |
|---|---|
| `catalogue` | Packages, prices and the discount ladder the shop reads |
| `checkout` | Prices the basket server side and raises the Stripe intent |
| `stripe-webhook` | The only place vouchers are minted, on Stripe's say-so |
| `order-status` | What the thank-you page is allowed to see about one order |
| `redeem` | Turns a voucher code into a Cooltix code for a chosen day |
| `invoice` | Számlázz.hu: issues the nyugta or számla and files the PDF |
| `send-voucher` | Renders the ticket and emails one gift to its receiver |
| `notify-sale` | The buyer's receipt, and the circuit's own sale notice |
| `admin` | The backoffice: refunds, code minting, exports, audit trail |
| `insights` | Read-only reporting: attribution, traffic, how an order was paid |
| `attribution` | Records the "where did you hear about us" answer |
| `hit` | Counts a page view, cookielessly, into `traffic_hits` |

## What is NOT here, by design

**Secrets.** No Stripe key, no Resend key, no Számlázz agent key, no
`send_token`. They live in Supabase's own secret store and in Stripe's
dashboard, and they do not belong in a git repository. If the project were
lost these would be reissued, not restored. The functions name them, so the
list of what to recreate is:

```
SUPABASE_URL                 SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY            STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET        RESEND_API_KEY
SZAMLAZZ_AGENT_KEY
```

plus the `send_token` row in the `settings` table, which is how the database
authenticates itself to its own functions.

**`render-test`.** A development helper, not part of the running system.

## Keeping it true

These were transcribed out of the live project on 18 November 2026. They match
what was deployed that day. They will drift the moment anything is deployed
without also being committed here.

The way to stop that drift is the Supabase CLI, which reads and writes the
same layout this folder uses:

```sh
supabase link --project-ref hbosxvmprhzrheilwwfv
supabase functions download <name>      # pull what is live into this folder
supabase functions deploy <name>        # push this folder to live
```

Once that is set up, this folder becomes the source and the deployed copy
follows it, rather than the other way round.
