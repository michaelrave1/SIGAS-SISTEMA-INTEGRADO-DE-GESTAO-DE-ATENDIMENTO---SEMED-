-- Consulta administrativa: encaminhamento ou reatribuição, preservando escopo.
begin;
create or replace function public.os_order_responsible_options(target uuid)
returns table(id uuid,user_id uuid,name text)
language plpgsql stable security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype;
begin
  if not (os_private.has_permission('orders.assign') or os_private.has_permission('orders.reassign')) then
    raise exception 'Acesso negado' using errcode='42501';
  end if;
  select o.* into current_order from public.os_orders o where o.id=target and o.active;
  if not found or not (
    os_private.is_admin() or os_private.is_area_manager(current_order)
  ) then raise exception 'Acesso negado'; end if;
  return query
  select m.id,m.user_id,p.name
  from public.os_memberships m
  join public.os_professionals p on p.id=m.professional_id and p.active
  join public.os_order_area_assignments assignment
    on assignment.membership_id=m.id and assignment.order_id=current_order.id
  where m.active and m.role='responsavel' and m.user_id is not null
  order by p.name,m.id;
end;
$$;


commit;
