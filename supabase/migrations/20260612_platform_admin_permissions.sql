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

update public.profiles
set role = 'mod'
where lower(display_name) = 'francisconunes1'
  and role <> 'mod';
