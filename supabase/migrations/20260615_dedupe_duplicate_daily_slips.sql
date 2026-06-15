with slip_items_signature as (
  select
    slip.id as slip_id,
    coalesce(string_agg(item.pick_id, ',' order by item.pick_id), '') as pick_signature
  from public.daily_slips slip
  left join public.slip_items item on item.slip_id = slip.id
  group by slip.id
),
slip_signatures as (
  select
    slip.id,
    row_number() over (
      partition by
        slip.day,
        slip.league_id,
        slip.mode,
        date_trunc('minute', slip.published_at),
        slip.combined_stake,
        slip.multiples_stake,
        item_signature.pick_signature
      order by
        case when slip.settlement_status <> 'pending' then 0 else 1 end,
        slip.published_at desc,
        slip.id desc
    ) as duplicate_rank
  from public.daily_slips slip
  join slip_items_signature item_signature on item_signature.slip_id = slip.id
)
delete from public.daily_slips slip
using slip_signatures signature
where slip.id = signature.id
  and signature.duplicate_rank > 1;
