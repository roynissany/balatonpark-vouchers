-- Tables, views and scheduled jobs as they stood on 18 November 2026.
--
-- Column lists rather than a true pg_dump: enough to rebuild the shape and
-- to read the system, not enough to restore byte-for-byte. For a real
-- restore, take a backup from the Supabase dashboard.
--
-- Constraints, indexes and row-level-security policies are NOT captured
-- here. Every table has RLS enabled and almost none has a policy: the
-- functions reach them with the service role, and nothing reads them
-- directly from a browser.

-- ============================================================ core tables

-- Who may use the backoffice. Invitation only - there is no sign-up path
-- anywhere in the system.
TABLE admin_users
  email       text not null
  full_name   text
  active      boolean not null default true
  created_at  timestamptz not null default now()

-- What is for sale. list_price_cents is the undiscounted value and is what
-- a voucher is worth when redeemed; price_cents is what it sells for.
TABLE packages
  id                uuid not null default gen_random_uuid()
  code              text not null
  name              text not null
  price_cents       integer not null
  currency          text not null default 'EUR'
  session_count     integer
  includes_room     boolean not null default false
  active            boolean not null default true
  sort_order        integer not null default 0
  sellable          boolean not null default true
  is_session_code   boolean not null default false
  splittable        boolean not null default false
  list_price_cents  integer

-- The volume ladder. min_sessions is counted across the whole basket.
TABLE discount_tiers
  min_qty       integer not null
  percent       integer not null
  min_sessions  integer
  unit_cents    integer

TABLE track_days
  id                 uuid not null default gen_random_uuid()
  event_date         date not null
  public_label       text not null
  cooltix_event_url  text
  status             text not null default 'draft'
  created_at         timestamptz not null default now()

-- The Cooltix discount codes, loaded in bulk per day per package.
-- status: available -> issued -> burned
TABLE cooltix_codes
  id            uuid not null default gen_random_uuid()
  track_day_id  uuid not null
  package_id    uuid not null
  code          text not null
  status        text not null default 'available'
  batch_label   text
  issued_at     timestamptz
  created_at    timestamptz not null default now()

-- One purchase. gifts is the array of receivers; items is every line
-- flattened, which is what the tax document is built from.
TABLE orders
  id                  uuid not null default gen_random_uuid()
  stripe_session_id   text
  stripe_payment_id   text
  buyer_name          text
  buyer_email         text not null
  recipient_name      text
  recipient_email     text not null
  gift_message        text
  delivery_method     text not null default 'now'
  deliver_at          timestamptz
  gross_cents         integer not null default 0
  discount_cents      integer not null default 0
  total_cents         integer not null default 0
  vat_rate            numeric(4,3) not null default 0.270
  invoice_number      text
  invoice_url         text
  status              text not null default 'pending'
  created_at          timestamptz not null default now()
  paid_at             timestamptz
  items               jsonb not null default '[]'
  gifts               jsonb
  lang                text
  invoice_kind        text
  invoice_name        text
  invoice_tax_number  text
  invoice_country     text
  invoice_postcode    text
  invoice_city        text
  invoice_address     text
  invoice_error       text
  invoiced_at         timestamptz
  heard_about         text

-- One voucher. Minted only by fulfil_order(), never from the browser.
TABLE vouchers
  id                  uuid not null default gen_random_uuid()
  order_id            uuid not null
  package_id          uuid not null
  code                text not null
  status              text not null default 'unredeemed'
  face_value_cents    integer not null
  paid_value_cents    integer not null
  redeemed_at         timestamptz
  expires_on          date not null
  created_at          timestamptz not null default now()
  sessions_total      integer not null
  sessions_remaining  integer not null
  gift_index          integer

-- One exchange of sessions for a Cooltix code on one day.
TABLE voucher_redemptions
  id               uuid not null default gen_random_uuid()
  voucher_id       uuid not null
  track_day_id     uuid not null
  cooltix_code_id  uuid not null
  package_id       uuid not null
  part_number      integer not null
  created_at       timestamptz not null default now()
  sessions         integer not null

-- ====================================================== plumbing and logs

TABLE settings
  key    text not null
  value  jsonb not null

TABLE stripe_events
  id            text not null
  type          text not null
  order_id      uuid
  processed_at  timestamptz not null default now()
  payload       jsonb

-- The queue behind every email. dispatch_outbox() drains it each minute.
TABLE email_outbox
  id          bigint not null
  order_id    uuid not null
  kind        text not null
  gift_index  integer
  due_at      timestamptz not null default now()
  state       text not null default 'pending'
  attempts    integer not null default 0
  request_id  bigint
  last_error  text
  created_at  timestamptz not null default now()
  sent_at     timestamptz

TABLE email_log
  id           bigint not null
  voucher_id   uuid
  order_id     uuid
  to_address   text not null
  template     text not null
  provider_id  text
  status       text not null default 'queued'
  created_at   timestamptz not null default now()
  gift_index   integer
  error        text

TABLE audit_log
  id           bigint not null
  actor_email  text
  action       text not null
  voucher_id   uuid
  order_id     uuid
  detail       jsonb
  created_at   timestamptz not null default now()

-- Rate limiting for the redeem page.
TABLE redemption_attempts
  id          bigint not null
  code_tried  text not null
  ip          inet
  user_agent  text
  succeeded   boolean not null default false
  created_at  timestamptz not null default now()

-- =========================================================== traffic (new)

-- Raw page views. No cookie, no address: visitor_hash is a salted daily
-- hash computed in the hit function. Rolled up hourly, then discarded.
TABLE traffic_hits
  id            bigint not null
  at            timestamptz not null default now()
  day           date not null default ((now() at time zone 'utc'))::date
  page          text not null default 'other'
  country       text not null default '??'
  is_mobile     boolean not null default false
  channel       text not null default 'direct'
  visitor_hash  text not null

-- The reporting table behind the Traffic tab. Rows with source='edge_logs'
-- are the 10-18 November window rescued from Supabase's own logs before
-- they expired, and are never overwritten by the rollup.
TABLE traffic_daily
  day              date not null
  country          text not null default '??'
  hits             integer not null default 0
  visitors         integer not null default 0
  mobile_hits      integer not null default 0
  instagram_hits   integer not null default 0
  facebook_hits    integer not null default 0
  shop_views       integer not null default 0
  checkout_starts  integer not null default 0
  redeems          integer not null default 0
  source           text not null default 'edge_logs'
  imported_at      timestamptz not null default now()
  is_test          boolean not null default false

-- ==================================================================== views

VIEW activity_feed
  at, kind, order_id, voucher_id, voucher_code, package_name,
  buyer_name, buyer_email, recipient_name, recipient_email,
  amount_cents, order_total_cents, actor_email, detail_text, order_status

VIEW liability_summary
  vouchers_unredeemed, vouchers_partial, vouchers_redeemed,
  outstanding_face_cents, outstanding_paid_cents

VIEW revenue_summary
  collected_cents, refunded_cents, discount_given_cents,
  net_of_vat_cents, vat_cents, paid_orders, refunded_orders

VIEW pool_levels
  track_day_id, event_date, public_label,
  package_id, package_code, package_name, available, total

VIEW voucher_parts
  voucher_id, part_number, sessions, event_date, public_label,
  cooltix_event_url, package_name, cooltix_code, created_at

-- =========================================================== scheduled jobs
--
-- pg_cron. Recreate with cron.schedule(name, schedule, command).

-- Drains the email queue.
--   dispatch-emails    * * * * *      select public.dispatch_outbox(10);

-- Stops the catalogue function going cold, which once cost 5.8 seconds on
-- the first visit after an idle period.
--   warm-catalogue     */2 * * * *    (http_get on /functions/v1/catalogue)

-- Rolls raw page views into traffic_daily.
--   roll-up-traffic    7 * * * *      select public.roll_up_traffic(2);

-- ================================================================= settings
--
-- The keys in the settings table. Values that are addresses or secrets are
-- not reproduced here; read them from the live table if they are needed.
--
--   alert_email             (address)
--   currency                eur
--   invoice_payment_label   bankkártya
--   nyugta_prefix           BPC          (Számlázz allows max 5 chars)
--   pool_alert_threshold    40
--   sales_inbox             (address)
--   send_token              (secret - how the database authenticates to its
--                            own functions; reissue if ever exposed)
--   site_url                https://gifts.balatonpark.com
--   vat_rate                0.27
--   voucher_expires_on      2027-12-31
