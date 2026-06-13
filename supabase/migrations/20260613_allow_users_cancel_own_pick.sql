create or replace function public.cancel_own_pick(p_pick_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.votes
  where pick_id = p_pick_id
    and exists (
      select 1
      from public.picks
      where picks.id = p_pick_id
        and picks.user_id = auth.uid()
        and picks.status = 'pending'
        and not exists (
          select 1
          from public.slip_items
          where slip_items.pick_id = p_pick_id
        )
    );

  delete from public.picks
  where id = p_pick_id
    and user_id = auth.uid()
    and status = 'pending'
    and not exists (
      select 1
      from public.slip_items
      where slip_items.pick_id = p_pick_id
    );
end;
$$;

grant execute on function public.cancel_own_pick(text) to authenticated;
