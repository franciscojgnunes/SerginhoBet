do $$
begin
  create type public.league_member_role as enum ('member', 'mod', 'streamer');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  streamer_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leagues_code_format'
  ) then
    alter table public.leagues
      add constraint leagues_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$');
  end if;
end $$;

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.league_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.picks
  add column if not exists league_id uuid references public.leagues(id) on delete cascade;

alter table public.daily_slips
  add column if not exists league_id uuid references public.leagues(id) on delete cascade;

create index if not exists leagues_code_idx on public.leagues(code);
create index if not exists league_members_user_idx on public.league_members(user_id);
create index if not exists picks_league_day_created_at_idx on public.picks(league_id, day, created_at desc);
create index if not exists daily_slips_league_day_published_at_idx on public.daily_slips(league_id, day, published_at desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'leagues_touch_updated_at'
  ) then
    create trigger leagues_touch_updated_at
    before update on public.leagues
    for each row execute function public.touch_updated_at();
  end if;
end $$;

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leagues' and policyname = 'leagues are readable by logged users') then
    create policy "leagues are readable by logged users"
    on public.leagues for select
    to authenticated
    using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leagues' and policyname = 'streamers manage leagues') then
    create policy "streamers manage leagues"
    on public.leagues for all
    to authenticated
    using (public.is_streamer())
    with check (public.is_streamer());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'league_members' and policyname = 'league members are readable by logged users') then
    create policy "league members are readable by logged users"
    on public.league_members for select
    to authenticated
    using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'league_members' and policyname = 'users join leagues as themselves') then
    create policy "users join leagues as themselves"
    on public.league_members for insert
    to authenticated
    with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'league_members' and policyname = 'streamers manage league members') then
    create policy "streamers manage league members"
    on public.league_members for all
    to authenticated
    using (public.is_streamer())
    with check (public.is_streamer());
  end if;
end $$;

insert into public.leagues (code, name, streamer_id)
select 'SERGINHO', 'SerginhoEsteves', id
from public.profiles
where lower(display_name) = 'serginhoesteves'
order by created_at
limit 1
on conflict (code) do update
set
  name = excluded.name,
  streamer_id = coalesce(public.leagues.streamer_id, excluded.streamer_id);

insert into public.leagues (code, name)
select 'SERGINHO', 'SerginhoEsteves'
where not exists (select 1 from public.leagues where code = 'SERGINHO');

insert into public.league_members (league_id, user_id, role)
select leagues.id, profiles.id, 'streamer'
from public.leagues
join public.profiles on lower(profiles.display_name) = 'serginhoesteves'
where leagues.code = 'SERGINHO'
on conflict (league_id, user_id) do update
set role = excluded.role;

update public.picks
set league_id = (select id from public.leagues where code = 'SERGINHO')
where league_id is null;

update public.daily_slips
set league_id = (select id from public.leagues where code = 'SERGINHO')
where league_id is null;
