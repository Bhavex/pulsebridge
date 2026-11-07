alter table public.donor_directory
  add column if not exists user_id uuid unique references auth.users (id) on delete cascade,
  add column if not exists hospital text not null default '' check (char_length(hospital) <= 120),
  add column if not exists last_donation_date date,
  add column if not exists availability_confirmed_at timestamptz not null default now(),
  add column if not exists last_reminder_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.donor_directory
  add column if not exists hospital_lower text generated always as (lower(btrim(hospital))) stored;

create index if not exists donor_directory_hospital_idx on public.donor_directory (hospital_lower);
create index if not exists donor_directory_confirmed_idx on public.donor_directory (available, availability_confirmed_at);

alter table public.donor_private
  add column if not exists registration_number text not null default '' check (char_length(registration_number) <= 40);

alter table public.contact_requests
  add column if not exists patient_name text check (patient_name is null or char_length(btrim(patient_name)) between 1 and 80),
  add column if not exists blood_group_needed text check (blood_group_needed is null or blood_group_needed in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  add column if not exists units_needed integer check (units_needed is null or units_needed between 1 and 10),
  add column if not exists hospital_name text check (hospital_name is null or char_length(btrim(hospital_name)) between 1 and 120),
  add column if not exists hospital_city text check (hospital_city is null or char_length(btrim(hospital_city)) between 1 and 80),
  add column if not exists required_by date,
  add column if not exists slip_path text check (slip_path is null or char_length(slip_path) <= 300),
  add column if not exists donor_responded_at timestamptz,
  add column if not exists report_reason text check (report_reason is null or char_length(report_reason) <= 300);

alter table public.contact_requests drop constraint if exists contact_requests_status_check;
alter table public.contact_requests add constraint contact_requests_status_check
  check (status in ('pending','accepted','declined','cancelled','expired','reported','completed','contacted','rejected'));

create index if not exists contact_requests_status_idx on public.contact_requests (status, created_at);

create table if not exists public.blocked_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 300),
  created_at timestamptz not null default now()
);

create table if not exists public.search_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists search_log_user_idx on public.search_log (user_id, created_at);

create table if not exists public.contact_reveals (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.contact_requests (id) on delete cascade,
  viewer_uid uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.availability_tokens (
  token_hash text primary key,
  donor_id uuid not null references public.donor_directory (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.blocked_users enable row level security;
alter table public.search_log enable row level security;
alter table public.contact_reveals enable row level security;
alter table public.availability_tokens enable row level security;

drop policy if exists "Signed-in users read directory" on public.donor_directory;
drop policy if exists "Admin reads private donor data" on public.donor_private;
drop policy if exists "Users create own pending requests" on public.contact_requests;
drop policy if exists "Admin reads requests" on public.contact_requests;
drop policy if exists "Admin updates request status" on public.contact_requests;
drop policy if exists "Admin deletes requests" on public.contact_requests;

revoke all on public.admin_emails, public.donor_directory, public.donor_private, public.contact_requests,
  public.blocked_users, public.search_log, public.contact_reveals, public.availability_tokens
  from anon, authenticated;

create or replace function public.is_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocked_users where user_id = auth.uid());
$$;

create or replace function public.require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.blocked_users where user_id = v_uid) then
    raise exception 'This account has been blocked. Contact the PulseBridge team.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public.compatible_donor_groups(p_recipient text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_recipient
    when 'O-' then array['O-']
    when 'O+' then array['O+','O-']
    when 'A-' then array['A-','O-']
    when 'A+' then array['A+','A-','O+','O-']
    when 'B-' then array['B-','O-']
    when 'B+' then array['B+','B-','O+','O-']
    when 'AB-' then array['AB-','A-','B-','O-']
    when 'AB+' then array['AB+','AB-','A+','A-','B+','B-','O+','O-']
    else array[]::text[]
  end;
$$;

create or replace function public.valid_phone(p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(p_phone), '') ~ '^\+?[0-9][0-9 -]{8,16}[0-9]$';
$$;

create or replace function public.expire_stale_requests()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.contact_requests
    set status = 'expired'
    where status = 'pending'
      and (created_at < now() - interval '72 hours' or (required_by is not null and required_by < current_date));
$$;

create or replace function public.save_my_donor_profile(
  p_name text,
  p_age integer,
  p_blood_group text,
  p_phone text,
  p_city text,
  p_state text,
  p_hospital text,
  p_last_donation_date date,
  p_registration_number text,
  p_consent boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_id uuid;
begin
  if p_consent is distinct from true then
    raise exception 'Please give consent to be listed as a donor.' using errcode = '22023';
  end if;
  if p_age is null or p_age < 18 or p_age > 65 then
    raise exception 'Donors must be between 18 and 65 years old.' using errcode = '22023';
  end if;
  if not public.valid_phone(p_phone) then
    raise exception 'Please enter a valid phone number.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_hospital, ''))) < 2 then
    raise exception 'Please enter a nearby hospital where you can donate.' using errcode = '22023';
  end if;
  if p_last_donation_date is not null and (p_last_donation_date > current_date or p_last_donation_date < date '1950-01-01') then
    raise exception 'Please enter a real last donation date.' using errcode = '22023';
  end if;

  select id into v_id from public.donor_directory where user_id = v_uid;

  if v_id is null then
    insert into public.donor_directory (user_id, name, age, blood_group, city, state, hospital, last_donation_date, available, availability_confirmed_at)
    values (v_uid, btrim(p_name), p_age, p_blood_group, btrim(p_city), btrim(p_state), btrim(p_hospital), p_last_donation_date, true, now())
    returning id into v_id;
  else
    update public.donor_directory
      set name = btrim(p_name), age = p_age, blood_group = p_blood_group, city = btrim(p_city), state = btrim(p_state),
          hospital = btrim(p_hospital), last_donation_date = p_last_donation_date, updated_at = now()
      where id = v_id;
  end if;

  insert into public.donor_private (donor_id, phone, email, registration_number, consent_given)
  values (v_id, btrim(p_phone), lower(coalesce(auth.jwt() ->> 'email', '')), btrim(coalesce(p_registration_number, '')), true)
  on conflict (donor_id) do update
    set phone = excluded.phone, email = excluded.email, registration_number = excluded.registration_number;

  return v_id;
end;
$$;

create or replace function public.get_my_donor_profile()
returns table (
  id uuid, name text, age integer, blood_group text, city text, state text, hospital text,
  last_donation_date date, available boolean, availability_confirmed_at timestamptz,
  phone text, registration_number text, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.name, d.age, d.blood_group, d.city, d.state, d.hospital, d.last_donation_date, d.available,
         d.availability_confirmed_at, p.phone, p.registration_number, d.created_at
  from public.donor_directory d
  left join public.donor_private p on p.donor_id = d.id
  where d.user_id = auth.uid() and auth.uid() is not null;
$$;

create or replace function public.set_my_availability(p_available boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.donor_directory
    set available = coalesce(p_available, false),
        availability_confirmed_at = case when p_available then now() else availability_confirmed_at end,
        updated_at = now()
    where user_id = v_uid;
  if not found then
    raise exception 'You have not registered as a donor yet.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.delete_my_donor_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  delete from public.donor_directory where user_id = auth.uid();
end;
$$;

create or replace function public.search_donors(
  p_blood_group text default null,
  p_include_compatible boolean default false,
  p_city text default null,
  p_state text default null,
  p_hospital text default null,
  p_sort text default 'best'
)
returns table (
  id uuid, display_name text, age integer, blood_group text, city text, state text, hospital text,
  eligible_now boolean, last_donated text, exact_match boolean, confirmed_days_ago integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_groups text[];
  v_hospital text := nullif(lower(btrim(coalesce(p_hospital, ''))), '');
begin
  if (select count(*) from public.search_log where user_id = v_uid and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many searches. Please wait a little and try again.' using errcode = 'P0001';
  end if;
  insert into public.search_log (user_id) values (v_uid);

  if nullif(btrim(coalesce(p_blood_group, '')), '') is null then
    v_groups := null;
  elsif p_include_compatible then
    v_groups := public.compatible_donor_groups(p_blood_group);
  else
    v_groups := array[p_blood_group];
  end if;

  if v_hospital is not null then
    v_hospital := replace(replace(replace(v_hospital, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  return query
  select
    d.id,
    case when split_part(btrim(d.name), ' ', 2) = '' then split_part(btrim(d.name), ' ', 1)
         else split_part(btrim(d.name), ' ', 1) || ' ' || upper(left(split_part(btrim(d.name), ' ', 2), 1)) || '.' end,
    d.age,
    d.blood_group,
    d.city,
    d.state,
    d.hospital,
    (d.last_donation_date is null or d.last_donation_date <= current_date - 90),
    case
      when d.last_donation_date is null then 'Not shared'
      when d.last_donation_date > current_date - 90 then 'Within the last 3 months'
      when d.last_donation_date > current_date - 180 then '3 to 6 months ago'
      else 'Over 6 months ago'
    end,
    (p_blood_group is null or d.blood_group = p_blood_group),
    (current_date - d.availability_confirmed_at::date)::integer
  from public.donor_directory d
  where d.available
    and d.availability_confirmed_at > now() - interval '37 days'
    and (d.user_id is null or d.user_id <> v_uid)
    and (v_groups is null or d.blood_group = any (v_groups))
    and (nullif(btrim(coalesce(p_city, '')), '') is null or d.city_lower = lower(btrim(p_city)))
    and (nullif(btrim(coalesce(p_state, '')), '') is null or d.state_lower = lower(btrim(p_state)))
    and (v_hospital is null or d.hospital_lower like '%' || v_hospital || '%')
  order by
    case when p_sort = 'hospital' then d.hospital_lower end asc nulls last,
    case when p_sort = 'city' then d.city_lower end asc nulls last,
    case when p_sort = 'recent' then d.availability_confirmed_at end desc nulls last,
    case when p_sort in ('best', 'exact') then (p_blood_group is null or d.blood_group = p_blood_group) end desc,
    (d.last_donation_date is null or d.last_donation_date <= current_date - 90) desc,
    d.availability_confirmed_at desc
  limit 50;
end;
$$;

create or replace function public.create_blood_request(
  p_donor_id uuid,
  p_patient_name text,
  p_blood_group_needed text,
  p_units integer,
  p_hospital_name text,
  p_hospital_city text,
  p_required_by date,
  p_requester_name text,
  p_requester_phone text,
  p_urgency text,
  p_message text,
  p_slip_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_donor public.donor_directory%rowtype;
  v_id uuid;
begin
  perform public.expire_stale_requests();

  select * into v_donor from public.donor_directory where id = p_donor_id;
  if not found or not v_donor.available or v_donor.availability_confirmed_at <= now() - interval '37 days' then
    raise exception 'This donor is not available right now.' using errcode = 'P0002';
  end if;
  if v_donor.user_id = v_uid then
    raise exception 'You cannot send a request to yourself.' using errcode = '22023';
  end if;
  if p_blood_group_needed is null or not (v_donor.blood_group = any (public.compatible_donor_groups(p_blood_group_needed))) then
    raise exception 'This donor''s blood group is not compatible with the blood group needed.' using errcode = '22023';
  end if;
  if not public.valid_phone(p_requester_phone) then
    raise exception 'Please enter a valid phone number.' using errcode = '22023';
  end if;
  if p_units is null or p_units < 1 or p_units > 10 then
    raise exception 'Units needed must be between 1 and 10.' using errcode = '22023';
  end if;
  if p_required_by is null or p_required_by < current_date or p_required_by > current_date + 60 then
    raise exception 'Please choose a required-by date within the next 60 days.' using errcode = '22023';
  end if;
  if p_slip_path is null or split_part(p_slip_path, '/', 1) <> v_uid::text or p_slip_path like '%..%' then
    raise exception 'Please upload the hospital requisition slip.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'requisition-slips' and o.name = p_slip_path) then
    raise exception 'The hospital requisition slip was not found. Please upload it again.' using errcode = '22023';
  end if;
  if (select count(*) from public.contact_requests where requester_uid = v_uid and created_at > now() - interval '24 hours') >= 15 then
    raise exception 'You have reached today''s request limit. Please try again tomorrow.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contact_requests where requester_uid = v_uid and donor_id = p_donor_id and status in ('pending', 'accepted')) then
    raise exception 'You already have an open request with this donor.' using errcode = '23505';
  end if;

  insert into public.contact_requests (
    donor_id, requester_uid, requester_name, requester_email, requester_phone, message, urgency, status,
    patient_name, blood_group_needed, units_needed, hospital_name, hospital_city, required_by, slip_path
  ) values (
    p_donor_id, v_uid, btrim(p_requester_name), lower(coalesce(auth.jwt() ->> 'email', '')), btrim(p_requester_phone),
    coalesce(nullif(btrim(coalesce(p_message, '')), ''), 'No extra message.'), p_urgency, 'pending',
    btrim(p_patient_name), p_blood_group_needed, p_units, btrim(p_hospital_name), btrim(p_hospital_city), p_required_by, p_slip_path
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.my_requests()
returns table (
  id uuid, created_at timestamptz, status text, patient_name text, blood_group_needed text, units_needed integer,
  hospital_name text, hospital_city text, required_by date, urgency text,
  donor_display_name text, donor_blood_group text, donor_city text, donor_responded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  perform public.expire_stale_requests();
  return query
  select r.id, r.created_at, case when r.status = 'reported' then 'declined' else r.status end,
         r.patient_name, r.blood_group_needed, r.units_needed, r.hospital_name, r.hospital_city, r.required_by, r.urgency,
         case when split_part(btrim(d.name), ' ', 2) = '' then split_part(btrim(d.name), ' ', 1)
              else split_part(btrim(d.name), ' ', 1) || ' ' || upper(left(split_part(btrim(d.name), ' ', 2), 1)) || '.' end,
         d.blood_group, d.city, r.donor_responded_at
  from public.contact_requests r
  join public.donor_directory d on d.id = r.donor_id
  where r.requester_uid = v_uid
  order by r.created_at desc
  limit 100;
end;
$$;

create or replace function public.incoming_requests()
returns table (
  id uuid, created_at timestamptz, status text, patient_name text, blood_group_needed text, units_needed integer,
  hospital_name text, hospital_city text, required_by date, urgency text, message text, requester_name text, slip_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  perform public.expire_stale_requests();
  return query
  select r.id, r.created_at, r.status, r.patient_name, r.blood_group_needed, r.units_needed, r.hospital_name, r.hospital_city,
         r.required_by, r.urgency, r.message, r.requester_name,
         case when r.status in ('pending', 'accepted') then r.slip_path else null end
  from public.contact_requests r
  join public.donor_directory d on d.id = r.donor_id
  where d.user_id = v_uid
  order by r.created_at desc
  limit 100;
end;
$$;

create or replace function public.respond_to_request(p_request_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_status text := case when p_accept then 'accepted' else 'declined' end;
begin
  perform public.expire_stale_requests();
  update public.contact_requests r
    set status = v_status, donor_responded_at = now()
    from public.donor_directory d
    where r.id = p_request_id and d.id = r.donor_id and d.user_id = v_uid and r.status = 'pending';
  if not found then
    raise exception 'This request can no longer be answered.' using errcode = 'P0002';
  end if;
  return v_status;
end;
$$;

create or replace function public.report_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.contact_requests r
    set status = 'reported', report_reason = left(btrim(coalesce(p_reason, '')), 300), donor_responded_at = now()
    from public.donor_directory d
    where r.id = p_request_id and d.id = r.donor_id and d.user_id = v_uid and r.status in ('pending', 'accepted');
  if not found then
    raise exception 'This request cannot be reported.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.cancel_my_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.contact_requests set status = 'cancelled'
    where id = p_request_id and requester_uid = v_uid and status in ('pending', 'accepted');
  if not found then
    raise exception 'This request cannot be cancelled.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.complete_my_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.contact_requests set status = 'completed'
    where id = p_request_id and requester_uid = v_uid and status = 'accepted';
  if not found then
    raise exception 'Only accepted requests can be marked as done.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.get_request_contact(p_request_id uuid)
returns table (contact_name text, contact_phone text, contact_role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_req public.contact_requests%rowtype;
  v_donor public.donor_directory%rowtype;
begin
  select * into v_req from public.contact_requests where id = p_request_id;
  if not found or v_req.status <> 'accepted' then
    raise exception 'Contact details are shared only after the donor accepts.' using errcode = '42501';
  end if;
  select * into v_donor from public.donor_directory where id = v_req.donor_id;

  if v_req.requester_uid = v_uid then
    insert into public.contact_reveals (request_id, viewer_uid) values (p_request_id, v_uid);
    return query select v_donor.name, p.phone, 'donor'::text from public.donor_private p where p.donor_id = v_donor.id;
  elsif v_donor.user_id = v_uid then
    insert into public.contact_reveals (request_id, viewer_uid) values (p_request_id, v_uid);
    return query select v_req.requester_name, v_req.requester_phone, 'recipient'::text;
  else
    raise exception 'Contact details are shared only after the donor accepts.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_list_donors()
returns table (
  id uuid, user_id uuid, name text, age integer, blood_group text, city text, state text, hospital text,
  last_donation_date date, available boolean, availability_confirmed_at timestamptz,
  phone text, email text, registration_number text, created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  return query
  select d.id, d.user_id, d.name, d.age, d.blood_group, d.city, d.state, d.hospital, d.last_donation_date, d.available,
         d.availability_confirmed_at, p.phone, p.email, p.registration_number, d.created_at
  from public.donor_directory d
  left join public.donor_private p on p.donor_id = d.id
  order by d.created_at desc;
end;
$$;

create or replace function public.admin_list_requests()
returns table (
  id uuid, created_at timestamptz, status text, urgency text, patient_name text, blood_group_needed text, units_needed integer,
  hospital_name text, hospital_city text, required_by date, message text, slip_path text, report_reason text,
  requester_uid uuid, requester_name text, requester_email text, requester_phone text,
  donor_id uuid, donor_name text, donor_blood_group text, donor_phone text, donor_responded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  perform public.expire_stale_requests();
  return query
  select r.id, r.created_at, r.status, r.urgency, r.patient_name, r.blood_group_needed, r.units_needed, r.hospital_name,
         r.hospital_city, r.required_by, r.message, r.slip_path, r.report_reason, r.requester_uid, r.requester_name,
         r.requester_email, r.requester_phone, d.id, d.name, d.blood_group, p.phone, r.donor_responded_at
  from public.contact_requests r
  join public.donor_directory d on d.id = r.donor_id
  left join public.donor_private p on p.donor_id = d.id
  order by (r.status = 'reported') desc, r.created_at desc
  limit 300;
end;
$$;

create or replace function public.admin_set_request_status(p_request_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if p_status not in ('pending','accepted','declined','cancelled','expired','reported','completed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update public.contact_requests set status = p_status where id = p_request_id;
end;
$$;

create or replace function public.admin_block_user(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  insert into public.blocked_users (user_id, reason) values (p_user_id, left(btrim(coalesce(p_reason, '')), 300))
  on conflict (user_id) do update set reason = excluded.reason;
  update public.contact_requests set status = 'cancelled' where requester_uid = p_user_id and status in ('pending', 'accepted');
  update public.donor_directory set available = false where user_id = p_user_id;
end;
$$;

create or replace function public.admin_unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  delete from public.blocked_users where user_id = p_user_id;
end;
$$;

create or replace function public.admin_list_blocked()
returns table (user_id uuid, reason text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  return query select b.user_id, b.reason, b.created_at from public.blocked_users b order by b.created_at desc;
end;
$$;

create or replace function public.issue_availability_reminders(p_limit integer default 200)
returns table (donor_id uuid, email text, first_name text, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_token text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.availability_tokens where expires_at < now() - interval '30 days';
  for r in
    select d.id, p.email, split_part(btrim(d.name), ' ', 1) as first_name
    from public.donor_directory d
    join public.donor_private p on p.donor_id = d.id
    where d.available
      and p.email <> ''
      and d.availability_confirmed_at < now() - interval '30 days'
      and (d.last_reminder_at is null or d.last_reminder_at < now() - interval '25 days')
    order by d.availability_confirmed_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  loop
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.availability_tokens (token_hash, donor_id, expires_at)
    values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), r.id, now() + interval '14 days');
    update public.donor_directory set last_reminder_at = now() where id = r.id;
    donor_id := r.id;
    email := r.email;
    first_name := r.first_name;
    token := v_token;
    return next;
  end loop;
end;
$$;

create or replace function public.confirm_availability_token(p_token text, p_available boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_donor_id uuid;
  v_name text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'This link is not valid.' using errcode = '22023';
  end if;
  update public.availability_tokens
    set used_at = now()
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and used_at is null and expires_at > now()
    returning donor_id into v_donor_id;
  if v_donor_id is null then
    raise exception 'This link has expired or was already used. Sign in to update your availability.' using errcode = 'P0002';
  end if;
  update public.donor_directory
    set available = coalesce(p_available, true),
        availability_confirmed_at = case when coalesce(p_available, true) then now() else availability_confirmed_at end,
        updated_at = now()
    where id = v_donor_id
    returning split_part(btrim(name), ' ', 1) into v_name;
  return coalesce(v_name, 'there');
end;
$$;

create or replace function public.donor_can_read_slip(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.contact_requests r
    join public.donor_directory d on d.id = r.donor_id
    where r.slip_path = p_name
      and r.status in ('pending', 'accepted')
      and d.user_id = auth.uid()
  );
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('requisition-slips', 'requisition-slips', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists "Slip owners upload" on storage.objects;
create policy "Slip owners upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'requisition-slips'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not (select public.is_blocked())
  );

drop policy if exists "Slip owners, matched donors and admins read" on storage.objects;
create policy "Slip owners, matched donors and admins read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'requisition-slips'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
      or public.donor_can_read_slip(name)
    )
  );

drop policy if exists "Slip owners delete" on storage.objects;
create policy "Slip owners delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'requisition-slips' and (storage.foldername(name))[1] = (select auth.uid())::text);

revoke all on function public.is_blocked() from public, anon;
revoke all on function public.donor_can_read_slip(text) from public, anon;
revoke all on function public.require_user() from public, anon, authenticated;
revoke all on function public.expire_stale_requests() from public, anon, authenticated;
revoke all on function public.save_my_donor_profile(text, integer, text, text, text, text, text, date, text, boolean) from public, anon;
revoke all on function public.get_my_donor_profile() from public, anon;
revoke all on function public.set_my_availability(boolean) from public, anon;
revoke all on function public.delete_my_donor_profile() from public, anon;
revoke all on function public.search_donors(text, boolean, text, text, text, text) from public, anon;
revoke all on function public.create_blood_request(uuid, text, text, integer, text, text, date, text, text, text, text, text) from public, anon;
revoke all on function public.my_requests() from public, anon;
revoke all on function public.incoming_requests() from public, anon;
revoke all on function public.respond_to_request(uuid, boolean) from public, anon;
revoke all on function public.report_request(uuid, text) from public, anon;
revoke all on function public.cancel_my_request(uuid) from public, anon;
revoke all on function public.complete_my_request(uuid) from public, anon;
revoke all on function public.get_request_contact(uuid) from public, anon;
revoke all on function public.admin_list_donors() from public, anon;
revoke all on function public.admin_list_requests() from public, anon;
revoke all on function public.admin_set_request_status(uuid, text) from public, anon;
revoke all on function public.admin_block_user(uuid, text) from public, anon;
revoke all on function public.admin_unblock_user(uuid) from public, anon;
revoke all on function public.admin_list_blocked() from public, anon;
revoke all on function public.issue_availability_reminders(integer) from public, anon, authenticated;
revoke all on function public.confirm_availability_token(text, boolean) from public;

grant execute on function public.is_blocked() to authenticated;
grant execute on function public.donor_can_read_slip(text) to authenticated;
grant execute on function public.save_my_donor_profile(text, integer, text, text, text, text, text, date, text, boolean) to authenticated;
grant execute on function public.get_my_donor_profile() to authenticated;
grant execute on function public.set_my_availability(boolean) to authenticated;
grant execute on function public.delete_my_donor_profile() to authenticated;
grant execute on function public.search_donors(text, boolean, text, text, text, text) to authenticated;
grant execute on function public.create_blood_request(uuid, text, text, integer, text, text, date, text, text, text, text, text) to authenticated;
grant execute on function public.my_requests() to authenticated;
grant execute on function public.incoming_requests() to authenticated;
grant execute on function public.respond_to_request(uuid, boolean) to authenticated;
grant execute on function public.report_request(uuid, text) to authenticated;
grant execute on function public.cancel_my_request(uuid) to authenticated;
grant execute on function public.complete_my_request(uuid) to authenticated;
grant execute on function public.get_request_contact(uuid) to authenticated;
grant execute on function public.admin_list_donors() to authenticated;
grant execute on function public.admin_list_requests() to authenticated;
grant execute on function public.admin_set_request_status(uuid, text) to authenticated;
grant execute on function public.admin_block_user(uuid, text) to authenticated;
grant execute on function public.admin_unblock_user(uuid) to authenticated;
grant execute on function public.admin_list_blocked() to authenticated;
grant execute on function public.issue_availability_reminders(integer) to service_role;
grant execute on function public.confirm_availability_token(text, boolean) to anon, authenticated;
