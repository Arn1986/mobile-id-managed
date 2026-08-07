-- Mobile ID Managed - initial schema
-- This migration is intended to be the first schema migration for a new Supabase project.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  ble_reader_name text not null default 'NVITE',
  badge_color_start text not null default '#4935A3',
  badge_color_end text not null default '#7A5BE7',
  logo_path text,
  credential_ttl_hours integer not null default 24 check (credential_ttl_hours between 1 and 720),
  config_version bigint not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  external_id text,
  first_name text not null,
  last_name text not null,
  email text not null,
  identifier_number text,
  role text not null default 'user' check (role in ('user', 'power_user', 'admin')),
  active boolean not null default true,
  last_credential_issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identifier_format_check check (
    identifier_number is null
    or identifier_number ~ '^08[0-9A-F]{16}$'
    or identifier_number ~ '^10[0-9A-F]{32}$'
    or identifier_number ~ '^57[0-9A-F]{28}$'
  )
);

create unique index if not exists profiles_email_lower_uq
  on public.profiles (lower(email));

create unique index if not exists profiles_identifier_uq
  on public.profiles (identifier_number)
  where identifier_number is not null;

create unique index if not exists profiles_tenant_external_id_uq
  on public.profiles (tenant_id, external_id)
  where external_id is not null;

create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  username text not null unique,
  password_hash text not null,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_client_username_lowercase check (username = lower(username))
);

create table if not exists public.credential_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete set null,
  site_id uuid references public.sites(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  api_client_id uuid references public.api_clients(id) on delete set null,
  event_type text not null,
  actor text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credential_audit_created_at_idx
  on public.credential_audit (created_at desc);

create index if not exists credential_audit_profile_idx
  on public.credential_audit (profile_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

drop trigger if exists sites_set_updated_at on public.sites;
create trigger sites_set_updated_at
before update on public.sites
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists api_clients_set_updated_at on public.api_clients;
create trigger api_clients_set_updated_at
before update on public.api_clients
for each row execute function public.set_updated_at();

-- A helper used only by Storage RLS policies.
create or replace function public.current_user_is_power_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role in ('power_user', 'admin')
  );
$$;

revoke all on function public.current_user_is_power_user() from public;
grant execute on function public.current_user_is_power_user() to authenticated;

-- Verify AEOS/server-to-server Basic Auth without exposing password hashes.
-- Passwords are stored using pgcrypto's bcrypt-based crypt()/gen_salt('bf').
create or replace function public.verify_api_client(p_username text, p_password text)
returns table(api_client_id uuid, tenant_id uuid, client_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  update public.api_clients c
     set last_used_at = now()
   where c.username = lower(trim(p_username))
     and c.active
     and c.password_hash = crypt(p_password, c.password_hash)
  returning c.id, c.tenant_id, c.name;
end;
$$;

revoke all on function public.verify_api_client(text, text) from public, anon, authenticated;
grant execute on function public.verify_api_client(text, text) to service_role;

-- Run this from the Supabase SQL editor to create/rotate an AEOS API client.
-- It is intentionally not callable by browser/mobile roles.
create or replace function public.upsert_api_client(
  p_username text,
  p_password text,
  p_name text default 'AEOS provisioning',
  p_tenant_id uuid default '00000000-0000-0000-0000-000000000001'::uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_username text := lower(trim(p_username));
begin
  if length(v_username) < 3 then
    raise exception 'API username must be at least 3 characters';
  end if;
  if length(p_password) < 20 then
    raise exception 'API password must be at least 20 characters';
  end if;

  update public.api_clients
     set password_hash = crypt(p_password, gen_salt('bf', 12)),
         name = p_name,
         tenant_id = p_tenant_id,
         active = true,
         updated_at = now()
   where username = v_username
  returning id into v_id;

  if v_id is null then
    insert into public.api_clients (tenant_id, name, username, password_hash)
    values (p_tenant_id, p_name, v_username, crypt(p_password, gen_salt('bf', 12)))
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.upsert_api_client(text, text, text, uuid) from public, anon, authenticated, service_role;

-- One-time bootstrap helper for the first power user.
-- First create the Auth user in Supabase Dashboard > Authentication > Users,
-- then call this function from the SQL editor using the same email.
create or replace function public.bootstrap_power_user(
  p_email text,
  p_first_name text default 'Power',
  p_last_name text default 'User',
  p_role text default 'power_user',
  p_tenant_id uuid default '00000000-0000-0000-0000-000000000001'::uuid,
  p_site_id uuid default '00000000-0000-0000-0000-000000000002'::uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  if p_role not in ('power_user', 'admin') then
    raise exception 'Role must be power_user or admin';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'No Supabase Auth user found for %', p_email;
  end if;

  insert into public.profiles (
    id, tenant_id, site_id, first_name, last_name, email, role, active
  ) values (
    v_user_id, p_tenant_id, p_site_id, trim(p_first_name), trim(p_last_name), lower(trim(p_email)), p_role, true
  )
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    site_id = excluded.site_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    role = excluded.role,
    active = true,
    updated_at = now();

  return v_user_id;
end;
$$;

revoke all on function public.bootstrap_power_user(text, text, text, text, uuid, uuid) from public, anon, authenticated, service_role;

-- Default single-tenant / single-site demo records.
insert into public.tenants (id, name, active)
values ('00000000-0000-0000-0000-000000000001', 'Mobile ID Managed Demo', true)
on conflict (id) do nothing;

insert into public.sites (
  id, tenant_id, name, ble_reader_name, badge_color_start, badge_color_end, credential_ttl_hours, active
) values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Default site',
  'NVITE',
  '#4935A3',
  '#7A5BE7',
  24,
  true
)
on conflict (id) do nothing;

-- Public logo bucket. Reads are public; writes are restricted to power users/admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('badge-assets', 'badge-assets', true, 2097152, array['image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS: browser/mobile clients get only the minimal data needed directly.
alter table public.tenants enable row level security;
alter table public.sites enable row level security;
alter table public.profiles enable row level security;
alter table public.api_clients enable row level security;
alter table public.credential_audit enable row level security;

revoke all on table public.tenants from anon, authenticated;
revoke all on table public.sites from anon, authenticated;
revoke all on table public.api_clients from anon, authenticated;
revoke all on table public.credential_audit from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;

create policy "profiles can read own row"
on public.profiles
for select
to authenticated
using (auth.uid() is not null and auth.uid() = id);

-- Storage write policies for the badge logo bucket.
drop policy if exists "power users insert badge assets" on storage.objects;
create policy "power users insert badge assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'badge-assets'
  and public.current_user_is_power_user()
);

drop policy if exists "power users update badge assets" on storage.objects;
create policy "power users update badge assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'badge-assets'
  and public.current_user_is_power_user()
)
with check (
  bucket_id = 'badge-assets'
  and public.current_user_is_power_user()
);

drop policy if exists "power users delete badge assets" on storage.objects;
create policy "power users delete badge assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'badge-assets'
  and public.current_user_is_power_user()
);
