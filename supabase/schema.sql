-- ============================================================================
-- Notre Planning — schéma Supabase
-- À exécuter une fois dans Supabase > SQL Editor (ré-exécutable sans risque).
-- ============================================================================

-- Foyer = planning commun reliant deux comptes ------------------------------
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  invite_code text not null unique
              default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  color        text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  household_id uuid references public.households on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.events (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users on delete cascade,
  title            text not null check (char_length(title) between 1 and 200),
  notes            text check (char_length(notes) <= 4000),
  location         text check (char_length(location) <= 200),
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  all_day          boolean not null default false,
  category         text not null default 'perso' check (category in ('pro', 'perso', 'commun')),
  is_private       boolean not null default false,
  recurrence       text not null default 'none'
                   check (recurrence in ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
  recurrence_until date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint events_end_after_start check (end_at > start_at),
  constraint events_commun_not_private check (not (is_private and category = 'commun'))
);
create index if not exists events_owner_start_idx on public.events (owner_id, start_at);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- Profil créé automatiquement à l'inscription -------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
                                split_part(new.email, '@', 1)), 60))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers (security definer pour éviter la récursion RLS) --------------------
create or replace function public.my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_partner(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and p.id <> auth.uid()
      and p.household_id is not null
      and p.household_id = public.my_household()
  )
$$;

-- Row Level Security ---------------------------------------------------------
alter table public.households enable row level security;
alter table public.profiles   enable row level security;
alter table public.events     enable row level security;

drop policy if exists "households: lecture membres" on public.households;
create policy "households: lecture membres" on public.households
  for select using (id = public.my_household());

drop policy if exists "profiles: lecture soi et partenaire" on public.profiles;
create policy "profiles: lecture soi et partenaire" on public.profiles
  for select using (id = auth.uid() or (household_id is not null and household_id = public.my_household()));

drop policy if exists "profiles: modification soi" on public.profiles;
create policy "profiles: modification soi" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Le foyer ne se change que via les fonctions create/join/leave_household.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, color) on public.profiles to authenticated;

-- Lecture directe : ses événements + ceux du partenaire non privés.
-- (Les créneaux privés du partenaire passent par list_events, masqués.)
drop policy if exists "events: lecture" on public.events;
create policy "events: lecture" on public.events
  for select using (owner_id = auth.uid() or (not is_private and public.is_partner(owner_id)));

drop policy if exists "events: création" on public.events;
create policy "events: création" on public.events
  for insert with check (owner_id = auth.uid());

-- Les événements "commun" sont modifiables par les deux membres du foyer.
drop policy if exists "events: modification" on public.events;
create policy "events: modification" on public.events
  for update
  using (owner_id = auth.uid() or (category = 'commun' and public.is_partner(owner_id)))
  with check (owner_id = auth.uid() or (category = 'commun' and public.is_partner(owner_id)));

drop policy if exists "events: suppression" on public.events;
create policy "events: suppression" on public.events
  for delete using (owner_id = auth.uid() or (category = 'commun' and public.is_partner(owner_id)));

revoke update on public.events from anon, authenticated;
grant update (title, notes, location, start_at, end_at, all_day, category, is_private,
              recurrence, recurrence_until) on public.events to authenticated;

-- Lecture des plannings croisés (privé du partenaire => « Occupé ») ----------
create or replace function public.list_events(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid, owner_id uuid, title text, notes text, location text,
  start_at timestamptz, end_at timestamptz, all_day boolean, category text,
  is_private boolean, recurrence text, recurrence_until date, is_mine boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.owner_id,
         case when e.owner_id = auth.uid() or not e.is_private then e.title else 'Occupé' end,
         case when e.owner_id = auth.uid() or not e.is_private then e.notes end,
         case when e.owner_id = auth.uid() or not e.is_private then e.location end,
         e.start_at, e.end_at, e.all_day, e.category, e.is_private,
         e.recurrence, e.recurrence_until,
         e.owner_id = auth.uid()
  from public.events e
  where (e.owner_id = auth.uid() or public.is_partner(e.owner_id))
    and e.start_at < p_to
    and (e.end_at > p_from
         or (e.recurrence <> 'none'
             and (e.recurrence_until is null or e.recurrence_until >= (p_from - interval '1 day')::date)))
  order by e.start_at
$$;

-- Gestion du foyer ------------------------------------------------------------
create or replace function public.leave_household() returns void
language plpgsql security definer set search_path = public as $$
declare
  h_id uuid := public.my_household();
begin
  if h_id is null then return; end if;
  update public.profiles set household_id = null where id = auth.uid();
  delete from public.households h
  where h.id = h_id and not exists (select 1 from public.profiles p where p.household_id = h_id);
end $$;

create or replace function public.create_household() returns public.households
language plpgsql security definer set search_path = public as $$
declare
  h public.households;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select * into h from public.households where id = public.my_household();
  if found then return h; end if;
  insert into public.households (created_by) values (auth.uid()) returning * into h;
  update public.profiles set household_id = h.id where id = auth.uid();
  return h;
end $$;

create or replace function public.join_household(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  h_id uuid;
  n int;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select id into h_id from public.households where invite_code = upper(trim(p_code)) for update;
  if h_id is null then raise exception 'Code d''invitation invalide'; end if;
  if h_id = public.my_household() then return; end if;
  select count(*) into n from public.profiles where household_id = h_id;
  if n >= 2 then raise exception 'Ce planning commun est déjà complet'; end if;
  perform public.leave_household();
  update public.profiles set household_id = h_id where id = auth.uid();
end $$;

revoke execute on function public.list_events(timestamptz, timestamptz) from public, anon;
revoke execute on function public.create_household() from public, anon;
revoke execute on function public.join_household(text) from public, anon;
revoke execute on function public.leave_household() from public, anon;
grant execute on function public.list_events(timestamptz, timestamptz) to authenticated;
grant execute on function public.create_household() to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.leave_household() to authenticated;

-- Temps réel : l'app se rafraîchit quand l'autre modifie son planning ---------
do $$
begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null;
end $$;
