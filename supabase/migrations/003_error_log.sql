create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid,
  page text not null default '' check (char_length(page) <= 120),
  message text not null default '' check (char_length(message) <= 500),
  detail text not null default '' check (char_length(detail) <= 1500),
  user_agent text not null default '' check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

create or replace function public.log_client_error(p_page text, p_message text, p_detail text, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.client_errors where created_at > now() - interval '1 minute') >= 60 then
    return;
  end if;
  if auth.uid() is not null and (select count(*) from public.client_errors where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    return;
  end if;
  insert into public.client_errors (user_id, page, message, detail, user_agent)
  values (auth.uid(), left(coalesce(p_page, ''), 120), left(coalesce(p_message, ''), 500), left(coalesce(p_detail, ''), 1500), left(coalesce(p_user_agent, ''), 300));
  delete from public.client_errors where created_at < now() - interval '60 days';
end;
$$;

create or replace function public.admin_list_errors()
returns table (id bigint, created_at timestamptz, page text, message text, detail text, user_agent text, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  return query
  select e.id, e.created_at, e.page, e.message, e.detail, e.user_agent, e.user_id
  from public.client_errors e
  order by e.created_at desc
  limit 100;
end;
$$;

create or replace function public.admin_clear_errors()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  delete from public.client_errors where true;
end;
$$;

create or replace function public.admin_export_backup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'donor_directory', coalesce((select jsonb_agg(to_jsonb(d)) from public.donor_directory d), '[]'::jsonb),
    'donor_private', coalesce((select jsonb_agg(to_jsonb(p)) from public.donor_private p), '[]'::jsonb),
    'contact_requests', coalesce((select jsonb_agg(to_jsonb(r)) from public.contact_requests r), '[]'::jsonb),
    'blocked_users', coalesce((select jsonb_agg(to_jsonb(b)) from public.blocked_users b), '[]'::jsonb),
    'admin_emails', coalesce((select jsonb_agg(to_jsonb(a)) from public.admin_emails a), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.log_client_error(text, text, text, text) from public;
revoke all on function public.admin_list_errors() from public, anon;
revoke all on function public.admin_clear_errors() from public, anon;
revoke all on function public.admin_export_backup() from public, anon;
grant execute on function public.log_client_error(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_list_errors() to authenticated;
grant execute on function public.admin_clear_errors() to authenticated;
grant execute on function public.admin_export_backup() to authenticated;
