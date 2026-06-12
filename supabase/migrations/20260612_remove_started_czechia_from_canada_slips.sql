delete from public.slip_items item
using public.picks pick, public.matches match, public.daily_slips slip
where item.pick_id = pick.id
  and item.slip_id = slip.id
  and pick.match_id = match.id
  and slip.settlement_status = 'pending'
  and lower(match.home_team) in ('south korea', 'coreia do sul')
  and lower(match.away_team) in ('czechia', 'república checa', 'republica checa')
  and exists (
    select 1
    from public.slip_items canada_item
    join public.picks canada_pick on canada_pick.id = canada_item.pick_id
    join public.matches canada_match on canada_match.id = canada_pick.match_id
    where canada_item.slip_id = slip.id
      and lower(canada_match.home_team) = 'canada'
      and lower(canada_match.away_team) in ('bosnia-herzegovina', 'bosnia & herzegovina', 'bosnia and herzegovina')
  );
