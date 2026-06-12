create or replace function public.update_own_pick_reason(p_pick_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.picks
  set reason = coalesce(nullif(trim(p_reason), ''), 'Sem justificacao.')
  where id = p_pick_id
    and user_id = auth.uid()
    and status = 'pending';
end;
$$;

grant execute on function public.update_own_pick_reason(text, text) to authenticated;
