do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'overlay can read profiles') then
    create policy "overlay can read profiles"
    on public.profiles for select
    to anon
    using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leagues' and policyname = 'overlay can read leagues') then
    create policy "overlay can read leagues"
    on public.leagues for select
    to anon
    using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'matches' and policyname = 'overlay can read matches') then
    create policy "overlay can read matches"
    on public.matches for select
    to anon
    using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'picks' and policyname = 'overlay can read picks') then
    create policy "overlay can read picks"
    on public.picks for select
    to anon
    using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'daily_slips' and policyname = 'overlay can read slips') then
    create policy "overlay can read slips"
    on public.daily_slips for select
    to anon
    using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'slip_items' and policyname = 'overlay can read slip items') then
    create policy "overlay can read slip items"
    on public.slip_items for select
    to anon
    using (true);
  end if;
end $$;
