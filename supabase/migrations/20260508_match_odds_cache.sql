create table if not exists public.match_odds (
  id text primary key,
  day date not null,
  match_id text not null,
  market_type text not null,
  selection text not null,
  odds numeric(10, 2) not null check (odds > 1),
  bookmaker text not null default 'API',
  fetched_at timestamptz not null default now()
);

create index if not exists match_odds_day_match_idx on public.match_odds(day, match_id);

alter table public.match_odds enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'match_odds' and policyname = 'match odds are readable by logged users') then
    create policy "match odds are readable by logged users"
    on public.match_odds for select
    to authenticated
    using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'match_odds' and policyname = 'logged users cache match odds') then
    create policy "logged users cache match odds"
    on public.match_odds for insert
    to authenticated
    with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'match_odds' and policyname = 'logged users update match odds cache') then
    create policy "logged users update match odds cache"
    on public.match_odds for update
    to authenticated
    using (true)
    with check (true);
  end if;
end $$;
