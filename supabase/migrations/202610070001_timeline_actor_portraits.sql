begin;

-- Enrich only visible timeline events, preserving the existing identity masking.
create or replace function public.os_order_timeline_actors(target uuid, event_ids bigint[])
returns table(event_id bigint, actor_key text, avatar_url text)
language plpgsql stable security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  internal_access boolean;
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if coalesce(array_length(event_ids, 1), 0) > 100 then
    raise exception 'Limite de eventos excedido';
  end if;
  select o.* into current_order from public.os_orders o
    where o.id = target and os_private.can_read_order(o);
  if not found then return; end if;
  internal_access := os_private.can_read_order_internal(current_order);
  return query
  select e.id,
    case when e.actor is null then 'system'
      when internal_access or e.actor = auth.uid() then e.actor::text
      else 'team' end,
    case when internal_access or e.actor = auth.uid()
      then coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
      else null end
  from public.os_order_events e
  left join auth.users u on u.id = e.actor
  where e.order_id = target and e.id = any(event_ids)
    and os_private.can_read_order_event(e.order_id, e.event_type);
end;
$$;
revoke all on function public.os_order_timeline_actors(uuid,bigint[]) from public, anon;
grant execute on function public.os_order_timeline_actors(uuid,bigint[]) to authenticated;

commit;
