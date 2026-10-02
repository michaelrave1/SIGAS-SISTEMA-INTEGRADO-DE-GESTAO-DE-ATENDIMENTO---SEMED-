-- Projeção limitada aos nomes dos responsáveis das OS visíveis na página.
-- Não amplia SELECT em profissionais, perfis ou vínculos.
begin;
create function public.os_order_current_responsibles(targets uuid[])
 returns table(order_id uuid,responsible_name text,responsible_kind text)
 language plpgsql stable security definer set search_path='' as $$
begin
 perform os_private.require_permission('orders.view');
 if targets is null or cardinality(targets)>100 then
  raise exception 'Lista de ordens inválida' using errcode='22023';
 end if;
 return query
 select o.id,
  case when o.responsible_id is not null then coalesce(professional.name,assigned.name)
   else managers.names end,
  case when o.responsible_id is not null then 'responsible'
   when managers.names is not null then 'area_manager' end
 from public.os_orders o
 left join public.os_memberships membership on membership.id=o.responsible_membership_id
  and membership.user_id=o.responsible_id
 left join public.os_professionals professional on professional.id=membership.professional_id
 left join public.os_profiles assigned on assigned.id=o.responsible_id
 left join public.os_catalogs category on category.id=o.category_id
 left join lateral (
  select string_agg(distinct coalesce(p.name,u.name),', ' order by coalesce(p.name,u.name)) names
  from public.os_memberships m
  join public.os_access_profiles profile on profile.id=m.access_profile_id
  left join public.os_professionals p on p.id=m.professional_id
  left join public.os_profiles u on u.id=m.user_id
  where m.active and m.role='gestor' and profile.key='area_manager' and profile.active
   and (p.id is null or p.active) and m.area=btrim(category.data->>'area')
   and o.responsible_id is null and o.status not in('Concluída','Cancelada')
 ) managers on true
 where o.id=any(targets) and o.active and os_private.can_read_order(o);
end; $$;
revoke all on function public.os_order_current_responsibles(uuid[]) from public,anon;
grant execute on function public.os_order_current_responsibles(uuid[]) to authenticated;
commit;
