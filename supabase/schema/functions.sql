-- Database functions, as they stood on 18 November 2026.
--
-- This is the part of the system that would be hardest to rebuild from
-- memory: the voucher lifecycle, refunds, how a Cooltix code is claimed
-- without two people getting the same one, and the email outbox.
--
-- Taken from pg_get_functiondef() against the live project, so these are
-- the definitions Postgres itself holds rather than a retyped approximation
-- of them.

CREATE OR REPLACE FUNCTION public.generate_voucher_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  candidate text;
  i integer;
begin
  loop
    candidate := 'BPC-';
    for i in 1..4 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    candidate := candidate || '-';
    for i in 1..4 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from vouchers where code = candidate);
  end loop;
  return candidate;
end;
$function$;


CREATE OR REPLACE FUNCTION public.fulfil_order(p_order_id uuid, p_payment_id text DEFAULT NULL::text)
 RETURNS TABLE(voucher_code text, package_name text, already_done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status   text;
  v_items    jsonb;
  v_gifts    jsonb;
  v_expires  date;
  v_gift     jsonb;
  v_item     jsonb;
  v_pkg      record;
  v_qty      integer;
  v_line     integer;
  v_each     integer;
  v_face     integer;
  v_gi       integer;
  i          integer;
  v_existing boolean := false;
begin
  select status, items, gifts into v_status, v_items, v_gifts
    from orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'order_not_found';
  end if;

  if v_status = 'paid' then
    v_existing := true;
  elsif v_status <> 'pending' then
    raise exception 'order_not_payable';
  else
    select (value #>> '{}')::date into v_expires
      from settings where key = 'voucher_expires_on';
    v_expires := coalesce(v_expires, (now() + interval '1 year')::date);

    -- An older order has no gifts: treat its items as a single gift.
    if v_gifts is null then
      v_gifts := jsonb_build_array(jsonb_build_object('items', coalesce(v_items, '[]'::jsonb)));
    end if;

    v_gi := 0;
    for v_gift in select * from jsonb_array_elements(v_gifts) loop
      for v_item in select * from jsonb_array_elements(v_gift -> 'items') loop
        select id, name, price_cents, list_price_cents, session_count, is_session_code
          into v_pkg
          from packages
         where code = (v_item ->> 'package_code');

        if v_pkg.id is null then
          raise exception 'unknown_package: %', (v_item ->> 'package_code');
        end if;

        v_qty  := (v_item ->> 'qty')::integer;
        v_line := (v_item ->> 'line_cents')::integer;
        v_each := round(v_line::numeric / greatest(v_qty, 1));
        -- Full value, not the discounted price: this is what the Cooltix
        -- codes behind the voucher are worth.
        v_face := coalesce(v_pkg.list_price_cents, v_pkg.price_cents);

        for i in 1..v_qty loop
          insert into vouchers
            (order_id, package_id, code, face_value_cents, paid_value_cents,
             expires_on, sessions_total, sessions_remaining, gift_index)
          values
            (p_order_id, v_pkg.id, generate_voucher_code(),
             v_face, v_each, v_expires,
             case when v_pkg.is_session_code then v_pkg.session_count else 1 end,
             case when v_pkg.is_session_code then v_pkg.session_count else 1 end,
             v_gi);
        end loop;
      end loop;
      v_gi := v_gi + 1;
    end loop;

    update orders
       set status = 'paid',
           paid_at = now(),
           stripe_payment_id = coalesce(p_payment_id, stripe_payment_id)
     where id = p_order_id;
  end if;

  begin
    perform public.enqueue_order_emails(p_order_id);
    perform public.dispatch_outbox(20);
  exception when others then
    raise warning 'email dispatch deferred for %: %', p_order_id, sqlerrm;
  end;

  return query
    select v.code, p.name, v_existing
      from vouchers v
      join packages p on p.id = v.package_id
     where v.order_id = p_order_id
     order by v.gift_index nulls first, p.sort_order, v.created_at;
end;
$function$;


CREATE OR REPLACE FUNCTION public.claim_cooltix_code(p_voucher_id uuid, p_track_day_id uuid, p_sessions integer DEFAULT NULL::integer)
 RETURNS TABLE(cooltix_code text, sessions_claimed integer, sessions_left integer, pool_remaining integer, fully_redeemed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status     text;
  v_pkg        uuid;
  v_splittable boolean;
  v_remaining  integer;
  v_want       integer;
  v_pool_id    uuid;
  v_code_id    uuid;
  v_code       text;
  v_left       integer;
begin
  select v.status, v.package_id, v.sessions_remaining, p.splittable
    into v_status, v_pkg, v_remaining, v_splittable
    from vouchers v
    join packages p on p.id = v.package_id
   where v.id = p_voucher_id
     for update of v;

  if v_status is null or v_status not in ('unredeemed','partially_redeemed') then
    raise exception 'voucher_not_redeemable';
  end if;

  -- No count given means "all that is left".
  v_want := coalesce(p_sessions, v_remaining);

  if v_want < 1 or v_want > v_remaining then
    raise exception 'bad_session_count';
  end if;

  if not v_splittable then
    -- A day product is all or nothing.
    if v_want <> v_remaining then
      raise exception 'not_splittable';
    end if;
    v_pool_id := v_pkg;
  else
    select id into v_pool_id
      from packages
     where is_session_code and session_count = v_want
     limit 1;

    if v_pool_id is null then
      raise exception 'no_pool_for_session_count';
    end if;
  end if;

  select id, code into v_code_id, v_code
    from cooltix_codes
   where track_day_id = p_track_day_id
     and package_id   = v_pool_id
     and status       = 'available'
   order by created_at
   for update skip locked
   limit 1;

  if v_code_id is null then
    raise exception 'pool_empty';
  end if;

  update cooltix_codes
     set status = 'issued', issued_at = now()
   where id = v_code_id;

  insert into voucher_redemptions
    (voucher_id, track_day_id, cooltix_code_id, package_id, part_number, sessions)
  values
    (p_voucher_id, p_track_day_id, v_code_id, v_pool_id,
     (select coalesce(max(part_number), 0) + 1
        from voucher_redemptions where voucher_id = p_voucher_id),
     v_want);

  update vouchers
     set sessions_remaining = sessions_remaining - v_want,
         status = case when sessions_remaining - v_want = 0
                       then 'redeemed' else 'partially_redeemed' end,
         redeemed_at = case when sessions_remaining - v_want = 0
                            then now() else redeemed_at end
   where id = p_voucher_id;

  select count(*) into v_left
    from cooltix_codes
   where track_day_id = p_track_day_id
     and package_id   = v_pool_id
     and status       = 'available';

  return query select
    v_code,
    v_want,
    v_remaining - v_want,
    v_left,
    (v_remaining - v_want) = 0;
end;
$function$;


CREATE OR REPLACE FUNCTION public.refund_order(p_order_id uuid, p_actor text DEFAULT NULL::text)
 RETURNS TABLE(vouchers_voided integer, codes_burned integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_voided integer;
  v_burned integer;
begin
  perform 1 from orders where id = p_order_id for update;

  update cooltix_codes c
     set status = 'burned'
    from voucher_redemptions r
    join vouchers v on v.id = r.voucher_id
   where c.id = r.cooltix_code_id
     and v.order_id = p_order_id
     and c.status = 'issued';
  get diagnostics v_burned = row_count;

  update vouchers
     set status = 'refunded'
   where order_id = p_order_id
     and status in ('unredeemed','partially_redeemed','redeemed');
  get diagnostics v_voided = row_count;

  update orders set status = 'refunded' where id = p_order_id;

  insert into audit_log (actor_email, action, order_id, detail)
  values (p_actor, 'order_refunded', p_order_id,
          jsonb_build_object('vouchers_voided', v_voided, 'codes_burned', v_burned));

  return query select v_voided, v_burned;
end;
$function$;


CREATE OR REPLACE FUNCTION public.enqueue_order_emails(p_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_n int := 0;
  v_added int;
begin
  -- The tax document first, then the circuit's notice and the buyer's
  -- receipt. The receipt is held back until the document exists, so it can
  -- carry it; dispatch_outbox enforces that ordering.
  insert into public.email_outbox (order_id, kind, gift_index, due_at)
  select o.id, k.kind, null, coalesce(o.paid_at, now())
  from public.orders o
  cross join (values ('invoice'), ('sale'), ('receipt')) as k(kind)
  where o.id = p_order_id and o.status = 'paid'
  on conflict do nothing;
  get diagnostics v_added = row_count;  v_n := v_n + v_added;

  insert into public.email_outbox (order_id, kind, gift_index, due_at)
  select o.id, 'gift', (g.ord - 1)::int,
         case when g.item->>'delivery_method' = 'scheduled'
              then coalesce((g.item->>'deliver_at')::timestamptz, o.paid_at, now())
              else coalesce(o.paid_at, now()) end
  from public.orders o
  cross join lateral jsonb_array_elements(coalesce(o.gifts, '[]'::jsonb))
    with ordinality g(item, ord)
  where o.id = p_order_id
    and o.status = 'paid'
    and coalesce(g.item->>'delivery_method', 'now') not in ('print','self','none')
    and coalesce(g.item->>'recipient_email', '') <> ''
  on conflict do nothing;
  get diagnostics v_added = row_count;  v_n := v_n + v_added;

  insert into public.email_outbox (order_id, kind, gift_index, due_at)
  select o.id, 'gift', 0,
         case when o.delivery_method = 'scheduled'
              then coalesce(o.deliver_at, o.paid_at, now())
              else coalesce(o.paid_at, now()) end
  from public.orders o
  where o.id = p_order_id
    and o.status = 'paid'
    and (o.gifts is null or jsonb_array_length(o.gifts) = 0)
    and coalesce(o.delivery_method, 'now') not in ('print','self','none')
    and coalesce(o.recipient_email, '') <> ''
  on conflict do nothing;
  get diagnostics v_added = row_count;  v_n := v_n + v_added;

  return v_n;
end;
$function$;


CREATE OR REPLACE FUNCTION public.dispatch_outbox(p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_token  text;
  v_inbox  text;
  v_base   text := 'https://hbosxvmprhzrheilwwfv.supabase.co/functions/v1/';
  v_job    record;
  v_req    bigint;
  v_ok     int := 0;
  v_fail   int := 0;
  v_fired  int := 0;
  v_queued int := 0;
  v_state  text;
begin
  select value #>> '{}' into v_token from public.settings where key = 'send_token';
  if v_token is null then raise exception 'send_token missing'; end if;
  select value #>> '{}' into v_inbox from public.settings where key = 'sales_inbox';

  for v_job in
    select o.id, o.request_id
    from public.email_outbox o
    where o.state = 'inflight' and o.request_id is not null
  loop
    update public.email_outbox o
       set state = case
             when r.status_code between 200 and 299 then 'sent'
             when o.attempts >= 5 then 'failed'
             else 'pending' end,
           sent_at = case when r.status_code between 200 and 299 then now() else null end,
           due_at = case when r.status_code between 200 and 299 or o.attempts >= 5
                         then o.due_at else now() + interval '5 minutes' end,
           last_error = case when r.status_code between 200 and 299 then null
                             else left(coalesce(r.error_msg, r.content, 'http ' || r.status_code), 400) end
      from net._http_response r
     where o.id = v_job.id and r.id = v_job.request_id
    returning o.state into v_state;

    if v_state = 'sent' then v_ok := v_ok + 1;
    elsif v_state is not null then v_fail := v_fail + 1;
    end if;
    v_state := null;
  end loop;

  update public.email_outbox
     set state = case when attempts >= 5 then 'failed' else 'pending' end,
         due_at = now(),
         last_error = 'no response recorded'
   where state = 'inflight'
     and created_at < now() - interval '20 minutes'
     and not exists (select 1 from net._http_response r where r.id = email_outbox.request_id);

  -- A refund or a reversal stops everything still queued for that order.
  update public.email_outbox o
     set state = 'cancelled', last_error = 'order no longer paid'
    from public.orders ord
   where ord.id = o.order_id
     and o.state in ('pending', 'inflight')
     and ord.status <> 'paid';

  for v_job in
    select id from public.orders
     where status = 'paid'
       and coalesce(paid_at, created_at) > now() - interval '60 days'
       and not exists (select 1 from public.email_outbox e where e.order_id = orders.id)
  loop
    v_queued := v_queued + public.enqueue_order_emails(v_job.id);
  end loop;

  for v_job in
    select e.id, e.order_id, e.kind, e.gift_index
      from public.email_outbox e
     where e.state = 'pending'
       and e.due_at <= now()
       and (e.kind <> 'receipt' or not exists (
             select 1 from public.email_outbox i
              where i.order_id = e.order_id and i.kind = 'invoice'
                and i.state in ('pending','inflight')
                and i.created_at > now() - interval '5 minutes'))
     order by e.due_at
     limit p_limit
  loop
    if v_job.kind = 'gift' then
      select net.http_post(
        url := v_base || 'send-voucher',
        headers := jsonb_build_object('Content-Type','application/json','x-send-token', v_token),
        body := jsonb_build_object('order_id', v_job.order_id, 'gift_index', coalesce(v_job.gift_index, 0)),
        timeout_milliseconds := 120000
      ) into v_req;
    elsif v_job.kind = 'invoice' then
      select net.http_post(
        url := v_base || 'invoice',
        headers := jsonb_build_object('Content-Type','application/json','x-send-token', v_token),
        body := jsonb_build_object('order_id', v_job.order_id),
        timeout_milliseconds := 60000
      ) into v_req;
    else
      select net.http_post(
        url := v_base || 'notify-sale',
        headers := jsonb_build_object('Content-Type','application/json','x-send-token', v_token),
        body := jsonb_strip_nulls(jsonb_build_object(
          'order_id', v_job.order_id, 'kind', v_job.kind,
          'to', case when v_job.kind = 'sale' then v_inbox else null end)),
        timeout_milliseconds := 60000
      ) into v_req;
    end if;

    update public.email_outbox
       set state = 'inflight', request_id = v_req, attempts = attempts + 1
     where id = v_job.id;
    v_fired := v_fired + 1;
  end loop;

  return jsonb_build_object('queued', v_queued, 'fired', v_fired,
                            'settled_ok', v_ok, 'settled_failed', v_fail);
end;
$function$;


CREATE OR REPLACE FUNCTION public.send_gift(p_order_id uuid, p_gift_index integer DEFAULT 0, p_to text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_token text;
  v_id    bigint;
begin
  select value #>> '{}' into v_token from settings where key = 'send_token';
  if v_token is null then raise exception 'send_token missing'; end if;

  select net.http_post(
    url := 'https://hbosxvmprhzrheilwwfv.supabase.co/functions/v1/send-voucher',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-send-token', v_token),
    body := jsonb_strip_nulls(jsonb_build_object(
      'order_id', p_order_id, 'gift_index', p_gift_index, 'to', p_to)),
    timeout_milliseconds := 60000
  ) into v_id;

  return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.admin_generate_codes(p_track_day_id uuid, p_package_code text, p_count integer, p_actor text)
 RETURNS TABLE(code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pkg_id uuid;
  v_label  text;
  v_date   date;
begin
  if p_count < 1 or p_count > 1000 then
    raise exception 'bad_count';
  end if;

  select id into v_pkg_id from packages where packages.code = p_package_code;
  if v_pkg_id is null then
    raise exception 'unknown_package';
  end if;

  select event_date into v_date from track_days where id = p_track_day_id;
  if v_date is null then
    raise exception 'unknown_track_day';
  end if;

  v_label := to_char(v_date, 'YYYYMMDD') || '-' || p_package_code
             || '-' || to_char(now(), 'YYYYMMDDHH24MI');

  insert into cooltix_codes (track_day_id, package_id, code, status, batch_label)
  select p_track_day_id,
         v_pkg_id,
         'BP' || to_char(v_date, 'MMDD') || '-' || upper(p_package_code) || '-'
              || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
         'available',
         v_label
    from generate_series(1, p_count);

  insert into audit_log (actor_email, action, detail)
  values (p_actor, 'generate_codes',
          jsonb_build_object('batch', v_label, 'count', p_count,
                             'package', p_package_code, 'date', v_date));

  return query
    select c.code from cooltix_codes c
     where c.batch_label = v_label
     order by c.created_at;
end;
$function$;


CREATE OR REPLACE FUNCTION public.admin_change_package(p_voucher_id uuid, p_new_package_code text, p_actor text)
 RETURNS TABLE(code text, package text, sessions_total integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_v      vouchers%rowtype;
  v_pkg    packages%rowtype;
  v_oldpkg text;
begin
  select * into v_v from vouchers where id = p_voucher_id for update;
  if not found then
    raise exception 'voucher_not_found';
  end if;
  if v_v.status <> 'unredeemed' or v_v.sessions_remaining <> v_v.sessions_total then
    raise exception 'voucher_already_in_use';
  end if;

  select * into v_pkg from packages where packages.code = p_new_package_code;
  if not found then
    raise exception 'unknown_package';
  end if;
  if not v_pkg.active then
    raise exception 'package_inactive';
  end if;

  select p.code into v_oldpkg from packages p where p.id = v_v.package_id;

  update vouchers
     set package_id         = v_pkg.id,
         sessions_total     = coalesce(v_pkg.session_count, 0),
         sessions_remaining = coalesce(v_pkg.session_count, 0),
         face_value_cents   = v_pkg.price_cents
   where id = p_voucher_id;

  insert into audit_log (actor_email, action, voucher_id, order_id, detail)
  values (p_actor, 'change_package', p_voucher_id, v_v.order_id,
          jsonb_build_object('from', v_oldpkg, 'to', p_new_package_code));

  return query
    select v_v.code, v_pkg.code, coalesce(v_pkg.session_count, 0);
end;
$function$;


CREATE OR REPLACE FUNCTION public.admin_change_redemption_date(p_redemption_id uuid, p_new_track_day_id uuid, p_actor text)
 RETURNS TABLE(old_code text, new_code text, track_day date, pool_remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_red        voucher_redemptions%rowtype;
  v_old_code   text;
  v_new_code_id uuid;
  v_new_code   text;
  v_date       date;
  v_left       integer;
begin
  select * into v_red from voucher_redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'redemption_not_found';
  end if;

  if v_red.track_day_id = p_new_track_day_id then
    raise exception 'same_track_day';
  end if;

  select event_date into v_date from track_days
   where id = p_new_track_day_id and status = 'published';
  if v_date is null then
    raise exception 'track_day_not_available';
  end if;

  select code into v_old_code from cooltix_codes where id = v_red.cooltix_code_id;

  -- Claim a replacement from the same package pool on the new date.
  select id, code into v_new_code_id, v_new_code
    from cooltix_codes
   where track_day_id = p_new_track_day_id
     and package_id   = v_red.package_id
     and status       = 'available'
   order by created_at
   for update skip locked
   limit 1;

  if v_new_code_id is null then
    raise exception 'pool_empty';
  end if;

  update cooltix_codes
     set status = 'burned'
   where id = v_red.cooltix_code_id;

  update cooltix_codes
     set status = 'issued', issued_at = now()
   where id = v_new_code_id;

  update voucher_redemptions
     set track_day_id    = p_new_track_day_id,
         cooltix_code_id = v_new_code_id
   where id = p_redemption_id;

  select count(*) into v_left
    from cooltix_codes
   where track_day_id = p_new_track_day_id
     and package_id   = v_red.package_id
     and status       = 'available';

  insert into audit_log (actor_email, action, voucher_id, detail)
  values (p_actor, 'change_redemption_date', v_red.voucher_id,
          jsonb_build_object(
            'redemption_id', p_redemption_id,
            'old_code', v_old_code,
            'new_code', v_new_code,
            'new_track_day', v_date));

  return query select v_old_code, v_new_code, v_date, v_left;
end;
$function$;


CREATE OR REPLACE FUNCTION public.roll_up_traffic(p_days integer DEFAULT 2)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  touched integer;
begin
  with src as (
    select h.day, h.country,
           count(*)                                           as hits,
           count(distinct h.visitor_hash)                     as visitors,
           count(*) filter (where h.is_mobile)                as mobile_hits,
           count(*) filter (where h.channel = 'instagram')    as instagram_hits,
           count(*) filter (where h.channel = 'facebook')     as facebook_hits,
           count(*) filter (where h.page = 'purchase')        as shop_views
      from traffic_hits h
     where h.day >= (now() at time zone 'utc')::date - p_days
     group by h.day, h.country
  ),
  -- Orders and redemptions have no country of their own, so they are put
  -- against the busiest country of the day rather than invented per row.
  lead_country as (
    select day, country,
           row_number() over (partition by day order by hits desc) as rn
      from src
  ),
  events as (
    select (o.created_at at time zone 'utc')::date as day,
           count(*) as checkout_starts
      from orders o
     where (o.created_at at time zone 'utc')::date >= (now() at time zone 'utc')::date - p_days
     group by 1
  ),
  reds as (
    select (r.created_at at time zone 'utc')::date as day,
           count(*) as redeems
      from voucher_redemptions r
     where (r.created_at at time zone 'utc')::date >= (now() at time zone 'utc')::date - p_days
     group by 1
  )
  insert into traffic_daily as t
    (day, country, hits, visitors, mobile_hits, instagram_hits, facebook_hits,
     shop_views, checkout_starts, redeems, source)
  select s.day, s.country, s.hits, s.visitors, s.mobile_hits, s.instagram_hits,
         s.facebook_hits, s.shop_views,
         case when lc.rn = 1 then coalesce(e.checkout_starts, 0) else 0 end,
         case when lc.rn = 1 then coalesce(rd.redeems, 0) else 0 end,
         'site'
    from src s
    join lead_country lc on lc.day = s.day and lc.country = s.country
    left join events e on e.day = s.day
    left join reds   rd on rd.day = s.day
  on conflict (day, country) do update set
    hits = excluded.hits, visitors = excluded.visitors,
    mobile_hits = excluded.mobile_hits, instagram_hits = excluded.instagram_hits,
    facebook_hits = excluded.facebook_hits, shop_views = excluded.shop_views,
    checkout_starts = excluded.checkout_starts, redeems = excluded.redeems,
    source = 'site', imported_at = now()
  -- Never overwrite a day that came from the edge-log import: that window
  -- predates this table and its counts are the only record of it.
  where t.source <> 'edge_logs';

  get diagnostics touched = row_count;

  -- The raw rows are only needed until they are rolled up.
  delete from traffic_hits
   where day < (now() at time zone 'utc')::date - 14;

  return touched;
end;
$function$;
