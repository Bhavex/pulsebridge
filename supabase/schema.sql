create table if not exists public.admin_emails (
  email text primary key check (email = lower(email))
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) and auth.role() = 'authenticated';
$$;

create table if not exists public.donor_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  age integer not null check (age between 18 and 120),
  blood_group text not null check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  city text not null check (char_length(btrim(city)) between 1 and 80),
  state text not null check (char_length(btrim(state)) between 1 and 80),
  city_lower text generated always as (lower(btrim(city))) stored,
  state_lower text generated always as (lower(btrim(state))) stored,
  available boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists donor_directory_search_idx on public.donor_directory (blood_group, city_lower, state_lower);

create table if not exists public.donor_private (
  donor_id uuid primary key references public.donor_directory (id) on delete cascade,
  phone text not null check (char_length(btrim(phone)) between 1 and 30),
  email text not null default '' check (char_length(email) <= 120),
  consent_given boolean not null check (consent_given = true),
  consent_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.donor_directory (id) on delete cascade,
  requester_uid uuid not null default auth.uid() references auth.users (id) on delete cascade,
  requester_name text not null check (char_length(btrim(requester_name)) between 1 and 80),
  requester_email text not null default coalesce(auth.jwt() ->> 'email', ''),
  requester_phone text not null check (char_length(btrim(requester_phone)) between 1 and 30),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  urgency text not null check (urgency in ('routine','soon','urgent')),
  status text not null default 'pending' check (status in ('pending','contacted','completed','rejected')),
  created_at timestamptz not null default now()
);

create index if not exists contact_requests_created_idx on public.contact_requests (created_at desc);
create index if not exists contact_requests_requester_idx on public.contact_requests (requester_uid, created_at);
create index if not exists contact_requests_donor_idx on public.contact_requests (donor_id);

create or replace function public.limit_contact_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.contact_requests
    where requester_uid = new.requester_uid
      and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Too many contact requests. Please try again later.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists contact_requests_rate_limit on public.contact_requests;
create trigger contact_requests_rate_limit
  before insert on public.contact_requests
  for each row execute function public.limit_contact_requests();

alter table public.admin_emails enable row level security;
alter table public.donor_directory enable row level security;
alter table public.donor_private enable row level security;
alter table public.contact_requests enable row level security;

revoke all on public.admin_emails, public.donor_directory, public.donor_private, public.contact_requests from anon, authenticated;

grant select on public.donor_directory to authenticated;
grant select on public.donor_private to authenticated;
grant select, delete on public.contact_requests to authenticated;
grant insert (donor_id, requester_name, requester_phone, message, urgency) on public.contact_requests to authenticated;
grant update (status) on public.contact_requests to authenticated;

drop policy if exists "Signed-in users read directory" on public.donor_directory;
create policy "Signed-in users read directory" on public.donor_directory
  for select to authenticated using (true);

drop policy if exists "Admin reads private donor data" on public.donor_private;
create policy "Admin reads private donor data" on public.donor_private
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Users create own pending requests" on public.contact_requests;
create policy "Users create own pending requests" on public.contact_requests
  for insert to authenticated
  with check (requester_uid = (select auth.uid()) and status = 'pending');

drop policy if exists "Admin reads requests" on public.contact_requests;
create policy "Admin reads requests" on public.contact_requests
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admin updates request status" on public.contact_requests;
create policy "Admin updates request status" on public.contact_requests
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admin deletes requests" on public.contact_requests;
create policy "Admin deletes requests" on public.contact_requests
  for delete to authenticated using ((select public.is_admin()));

create or replace function public.admin_save_donor(
  p_id uuid,
  p_name text,
  p_age integer,
  p_blood_group text,
  p_city text,
  p_state text,
  p_available boolean,
  p_phone text,
  p_email text,
  p_consent_given boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can save donor records.' using errcode = '42501';
  end if;
  if p_consent_given is distinct from true then
    raise exception 'Donor consent is required.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.donor_directory (name, age, blood_group, city, state, available)
    values (btrim(p_name), p_age, p_blood_group, btrim(p_city), btrim(p_state), coalesce(p_available, true))
    returning id into v_id;
    insert into public.donor_private (donor_id, phone, email, consent_given)
    values (v_id, btrim(p_phone), btrim(coalesce(p_email, '')), true);
  else
    update public.donor_directory
      set name = btrim(p_name), age = p_age, blood_group = p_blood_group,
          city = btrim(p_city), state = btrim(p_state), available = coalesce(p_available, true)
      where id = p_id
      returning id into v_id;
    if v_id is null then
      raise exception 'Donor not found.' using errcode = 'P0002';
    end if;
    insert into public.donor_private (donor_id, phone, email, consent_given)
    values (v_id, btrim(p_phone), btrim(coalesce(p_email, '')), true)
    on conflict (donor_id) do update
      set phone = excluded.phone, email = excluded.email;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_donor(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can delete donor records.' using errcode = '42501';
  end if;
  delete from public.donor_directory where id = p_id;
end;
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_save_donor(uuid, text, integer, text, text, text, boolean, text, text, boolean) from public, anon;
revoke all on function public.admin_delete_donor(uuid) from public, anon;
revoke all on function public.limit_contact_requests() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_save_donor(uuid, text, integer, text, text, text, boolean, text, text, boolean) to authenticated;
grant execute on function public.admin_delete_donor(uuid) to authenticated;
