do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'matches' and policyname = 'logged users cache matches') then
    create policy "logged users cache matches"
    on public.matches for insert
    to authenticated
    with check (true);
  end if;
end $$;
