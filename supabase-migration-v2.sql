-- Chronic Care Desk: cloud workspace snapshots
-- Run this after supabase-schema.sql.

create table if not exists public.workspace_snapshots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"p":[],"m":[],"r":[],"settings":{"remindDays":7}}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_workspace_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workspace_snapshots_updated_at on public.workspace_snapshots;
create trigger workspace_snapshots_updated_at before update on public.workspace_snapshots
for each row execute function public.set_workspace_updated_at();

alter table public.workspace_snapshots enable row level security;

drop policy if exists workspace_select on public.workspace_snapshots;
create policy workspace_select on public.workspace_snapshots for select
using (owner_id = auth.uid() or public.is_admin());

drop policy if exists workspace_insert on public.workspace_snapshots;
create policy workspace_insert on public.workspace_snapshots for insert
with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists workspace_update on public.workspace_snapshots;
create policy workspace_update on public.workspace_snapshots for update
using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists workspace_delete_admin on public.workspace_snapshots;
create policy workspace_delete_admin on public.workspace_snapshots for delete
using (public.is_admin());
