do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'picks'
      and policyname = 'streamers delete picks'
  ) then
    create policy "streamers delete picks"
    on public.picks for delete
    to authenticated
    using (public.is_streamer());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'votes'
      and policyname = 'users and streamers delete votes'
  ) then
    create policy "users and streamers delete votes"
    on public.votes for delete
    to authenticated
    using ((select auth.uid()) = user_id or public.is_streamer());
  end if;
end $$;
