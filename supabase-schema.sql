-- Chronic Care Desk: shared cloud data and role-based access
-- Run this once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'staff', 'viewer');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  phone text,
  insurance text,
  hospital text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  drug text not null,
  spec text,
  quantity numeric not null default 0,
  daily_dose numeric not null default 1,
  unit text not null default '片',
  start_date date not null default current_date,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped')),
  status_note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pickup_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  medication_id uuid not null references public.medications(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  pickup_date date not null default current_date,
  quantity numeric not null check (quantity > 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  source_name text,
  row_count integer not null default 0,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists patients_updated_at on public.patients;
create trigger patients_updated_at before update on public.patients
for each row execute function public.set_updated_at();
drop trigger if exists medications_updated_at on public.medications;
create trigger medications_updated_at before update on public.medications
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active = true
  );
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'staff') and active = true
  );
$$;

alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.medications enable row level security;
alter table public.pickup_records enable row level security;
alter table public.upload_batches enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update
using (public.is_admin()) with check (public.is_admin());

drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients for select
using (owner_id = auth.uid() or public.is_admin());
drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients for insert
with check (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));
drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients for update
using (public.is_staff() and (owner_id = auth.uid() or public.is_admin()))
with check (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));
drop policy if exists patients_delete on public.patients;
create policy patients_delete on public.patients for delete
using (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications for select
using (owner_id = auth.uid() or public.is_admin());
drop policy if exists medications_insert on public.medications;
create policy medications_insert on public.medications for insert
with check (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));
drop policy if exists medications_update on public.medications;
create policy medications_update on public.medications for update
using (public.is_staff() and (owner_id = auth.uid() or public.is_admin()))
with check (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));
drop policy if exists medications_delete on public.medications;
create policy medications_delete on public.medications for delete
using (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists pickup_select on public.pickup_records;
create policy pickup_select on public.pickup_records for select
using (owner_id = auth.uid() or public.is_admin());
drop policy if exists pickup_insert on public.pickup_records;
create policy pickup_insert on public.pickup_records for insert
with check (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));
drop policy if exists pickup_update on public.pickup_records;
create policy pickup_update on public.pickup_records for update
using (public.is_staff() and (owner_id = auth.uid() or public.is_admin()))
with check (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));
drop policy if exists pickup_delete on public.pickup_records;
create policy pickup_delete on public.pickup_records for delete
using (public.is_staff() and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists uploads_select on public.upload_batches;
create policy uploads_select on public.upload_batches for select
using (uploaded_by = auth.uid() or public.is_admin());
drop policy if exists uploads_insert on public.upload_batches;
create policy uploads_insert on public.upload_batches for insert
with check (uploaded_by = auth.uid() or public.is_admin());

drop policy if exists audit_select_admin on public.audit_logs;
create policy audit_select_admin on public.audit_logs for select
using (public.is_admin());
drop policy if exists audit_insert_auth on public.audit_logs;
create policy audit_insert_auth on public.audit_logs for insert
with check (actor_id = auth.uid() or public.is_admin());

-- After creating your first account, replace the email below and run this line once:
-- update public.profiles set role = 'admin' where email = 'your-admin-email@example.com';
