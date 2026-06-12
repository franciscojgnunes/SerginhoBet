create extension if not exists pgcrypto;

create type public.profile_role as enum ('viewer', 'mod', 'streamer');
create type public.league_member_role as enum ('member', 'mod', 'streamer');
create type public.match_status as enum ('scheduled', 'live', 'finished');
create type public.pick_status as enum ('pending', 'won', 'lost', 'void', 'half_won', 'half_lost');
create type public.slip_mode as enum ('combined', 'multiples');
create type public.slip_status as enum ('draft', 'published');
create type public.vote_type as enum ('trust', 'doubt', 'strong');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  twitch_id text unique,
  display_name text not null,
  avatar_url text,
  role public.profile_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  streamer_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leagues_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$')
);

create table public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.league_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table public.matches (
  id text primary key,
  day date not null,
  competition text not null,
  country text,
  home_team text not null,
  away_team text not null,
  starts_at timestamptz not null,
  status public.match_status not null default 'scheduled',
  home_score integer,
  away_score integer,
  home_logo_url text,
  away_logo_url text,
  home_record text,
  away_record text,
  venue text,
  source text default 'api',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.picks (
  id text primary key,
  day date not null,
  league_id uuid references public.leagues(id) on delete cascade,
  match_id text not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  market_type text not null,
  selection text not null,
  odds numeric(10, 2) not null check (odds > 1),
  stake numeric(10, 2) not null check (stake > 0),
  bookmaker text not null default 'Manual',
  reason text not null default '',
  status public.pick_status not null default 'pending',
  profit numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.votes (
  pick_id text not null references public.picks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.vote_type not null,
  created_at timestamptz not null default now(),
  primary key (pick_id, user_id)
);

create table public.match_odds (
  id text primary key,
  day date not null,
  match_id text not null,
  market_type text not null,
  selection text not null,
  odds numeric(10, 2) not null check (odds > 1),
  bookmaker text not null default 'API',
  fetched_at timestamptz not null default now()
);

create table public.daily_slips (
  id text primary key,
  day date not null,
  league_id uuid references public.leagues(id) on delete cascade,
  status public.slip_status not null default 'published',
  mode public.slip_mode not null default 'combined',
  combined_stake numeric(10, 2) not null default 1,
  multiples_stake numeric(10, 2) not null default 1,
  settlement_status public.pick_status not null default 'pending',
  profit numeric(10, 2) not null default 0,
  generated_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.profiles(id)
);

create table public.slip_items (
  slip_id text not null references public.daily_slips(id) on delete cascade,
  pick_id text not null references public.picks(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (slip_id, pick_id)
);

create index matches_day_starts_at_idx on public.matches(day, starts_at);
create index leagues_code_idx on public.leagues(code);
create index league_members_user_idx on public.league_members(user_id);
create index picks_league_day_created_at_idx on public.picks(league_id, day, created_at desc);
create index picks_day_created_at_idx on public.picks(day, created_at desc);
create index picks_user_day_idx on public.picks(user_id, day);
create index votes_user_idx on public.votes(user_id);
create index match_odds_day_match_idx on public.match_odds(day, match_id);
create index daily_slips_league_day_published_at_idx on public.daily_slips(league_id, day, published_at desc);
create index daily_slips_day_published_at_idx on public.daily_slips(day, published_at desc);
create index slip_items_slip_sort_idx on public.slip_items(slip_id, sort_order);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger matches_touch_updated_at
before update on public.matches
for each row execute function public.touch_updated_at();

create trigger leagues_touch_updated_at
before update on public.leagues
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, twitch_id, display_name, avatar_url, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'provider_id', new.raw_user_meta_data->>'sub'),
    coalesce(new.raw_user_meta_data->>'preferred_username', new.raw_user_meta_data->>'user_name', new.raw_user_meta_data->>'name', 'Viewer Twitch'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_streamer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        role in ('streamer', 'mod')
        or lower(display_name) = 'francisconunes1'
      )
  );
$$;

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.matches enable row level security;
alter table public.picks enable row level security;
alter table public.votes enable row level security;
alter table public.match_odds enable row level security;
alter table public.daily_slips enable row level security;
alter table public.slip_items enable row level security;

create policy "profiles are readable by logged users"
on public.profiles for select
to authenticated
using (true);

create policy "users can create their own viewer profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id and role = 'viewer');

create policy "users update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "matches are readable by logged users"
on public.matches for select
to authenticated
using (true);

create policy "logged users cache matches"
on public.matches for insert
to authenticated
with check (true);

create policy "leagues are readable by logged users"
on public.leagues for select
to authenticated
using (true);

create policy "streamers manage leagues"
on public.leagues for all
to authenticated
using (public.is_streamer())
with check (public.is_streamer());

create policy "league members are readable by logged users"
on public.league_members for select
to authenticated
using (true);

create policy "users join leagues as themselves"
on public.league_members for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "streamers manage league members"
on public.league_members for all
to authenticated
using (public.is_streamer())
with check (public.is_streamer());

create policy "picks are readable by logged users"
on public.picks for select
to authenticated
using (true);

create policy "users create their own picks"
on public.picks for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "streamers settle picks"
on public.picks for update
to authenticated
using (public.is_streamer())
with check (public.is_streamer());

create policy "votes are readable by logged users"
on public.votes for select
to authenticated
using (true);

create policy "match odds are readable by logged users"
on public.match_odds for select
to authenticated
using (true);

create policy "logged users cache match odds"
on public.match_odds for insert
to authenticated
with check (true);

create policy "logged users update match odds cache"
on public.match_odds for update
to authenticated
using (true)
with check (true);

create policy "users vote as themselves"
on public.votes for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users update their own votes"
on public.votes for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "slips are readable by logged users"
on public.daily_slips for select
to authenticated
using (true);

create policy "streamers publish and settle slips"
on public.daily_slips for insert
to authenticated
with check (public.is_streamer());

create policy "streamers update slips"
on public.daily_slips for update
to authenticated
using (public.is_streamer())
with check (public.is_streamer());

create policy "slip items are readable by logged users"
on public.slip_items for select
to authenticated
using (true);

create policy "streamers write slip items"
on public.slip_items for insert
to authenticated
with check (public.is_streamer());

create policy "streamers delete slip items"
on public.slip_items for delete
to authenticated
using (public.is_streamer());

insert into public.leagues (code, name)
values ('SERGINHO', 'SerginhoEsteves')
on conflict (code) do nothing;
