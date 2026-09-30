-- Schema registrado em produção, consultado somente por SELECT. Sem dados pessoais.
-- Vincula responsáveis a uma área do catálogo e limita a leitura de OS a ela.
begin;
alter table public.os_memberships
  add column area text check (area is null or length(btrim(area)) between 1 and 500);
create index os_memberships_responsible_area
  on public.os_memberships(area,user_id)
  where active and role='responsavel' and area is not null;
drop function public.os_professional_memberships(integer,integer);
create function public.os_professional_memberships(
  page_size integer default 25,page_offset integer default 0
) returns table(
  membership_id uuid,professional_id uuid,professional_name text,institutional_email text,
  registration text,job_title text,professional_active boolean,identity_linked boolean,
  relink_pending boolean,unit_id uuid,area text,role text,membership_active boolean,
  total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform os_private.require_permission('professionals.view');
  if not os_private.is_admin() then raise exception 'Acesso negado'; end if;
  return query
  select m.id,p.id,p.name,p.institutional_email,p.registration,p.job_title,p.active,
    p.auth_user_id is not null,p.auth_user_id is null and p.previous_auth_user_id is not null,
    m.unit_id,m.area,m.role,m.active,count(*) over()
  from public.os_professionals p
  left join public.os_memberships m on m.professional_id=p.id
  order by p.name,m.id
  limit greatest(1,least(coalesce(page_size,25),100))
  offset greatest(coalesce(page_offset,0),0);
end;
$$;
drop function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,boolean,boolean
);
create function public.os_save_professional_membership(
  target_membership uuid,target_professional uuid,professional_email text,
  professional_name text,professional_registration text,
  professional_position text,target_unit uuid,target_role text,target_area text,
  professional_active boolean,membership_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_membership uuid;
  normalized_area text := nullif(btrim(target_area),'');
begin
  perform os_private.require_permission(case
    when not professional_active or not membership_active then 'professionals.delete'
    when target_professional is null then 'professionals.create'
    else 'professionals.update' end);

  if target_role='responsavel' and normalized_area is null then
    raise exception 'Área obrigatória para o responsável';
  end if;
  if target_role<>'responsavel' and normalized_area is not null then
    raise exception 'Área permitida somente para o responsável';
  end if;
  if normalized_area is not null and not exists(
    select 1 from public.os_catalogs c
    where c.kind='logistics' and c.active and btrim(c.data->>'area')=normalized_area
  ) then raise exception 'Área inválida'; end if;

  saved_membership := os_private.os_save_professional_membership(
    target_membership,target_professional,professional_email,professional_name,
    professional_registration,professional_position,target_unit,target_role,
    professional_active,membership_active
  );
  update public.os_memberships set area=normalized_area where id=saved_membership;
  return saved_membership;
end;
$$;
create function os_private.is_area_responsible(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
    from public.os_memberships m
    join public.os_catalogs c on c.id=o.category_id and c.kind='logistics'
    where m.user_id=(select auth.uid()) and m.active
      and m.role='responsavel' and m.area is not null
      and btrim(c.data->>'area')=m.area
  );
$$;
create or replace function os_private.can_read_order_internal(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission('orders.view') and (
    os_private.is_admin()
    or os_private.is_origin_manager(o)
    or os_private.is_destination_manager(o)
    or os_private.is_area_responsible(o)
    or os_private.is_assigned_responsible(o)
  );
$$;
-- O escopo da área amplia somente a leitura. Alterações continuam exigindo
-- administração, gestão da unidade ou atribuição direta ao responsável.
create or replace function os_private.can_write_order(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission('orders.view') and exists(
    select 1 from public.os_orders o
    where o.id=target and o.active and o.status not in ('Concluída','Cancelada')
      and (
        os_private.is_admin()
        or os_private.is_origin_manager(o)
        or os_private.is_destination_manager(o)
        or os_private.is_assigned_responsible(o)
        or os_private.is_order_requester(o)
      )
  );
$$;
create or replace function os_private.can_read_catalog(c public.os_catalogs)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.has_permission(c.kind || '.view') and (
    os_private.is_admin() or (
      c.active and exists(
        select 1 from public.os_memberships m
        where m.user_id=(select auth.uid()) and m.active and (
          (m.role='solicitante' and exists(
            select 1 from public.os_units u where u.id=m.unit_id and u.active
          )) or
          (m.role='gestor' and m.unit_id is null) or
          (m.role='gestor' and exists(
            select 1 from public.os_orders o
            where m.unit_id in (o.unit_id,o.destination_unit_id)
              and c.id in (o.category_id,o.driver_id,o.vehicle_id,o.route_id)
          )) or
          (m.role='responsavel' and m.area is not null and (
            (c.kind='logistics' and btrim(c.data->>'area')=m.area) or exists(
              select 1 from public.os_orders o
              join public.os_catalogs category on category.id=o.category_id
              where btrim(category.data->>'area')=m.area
                and c.id in (o.driver_id,o.vehicle_id,o.route_id)
            )
          )) or
          (m.role='responsavel' and m.area is null and exists(
            select 1 from public.os_orders o
            where o.responsible_membership_id=m.id
              and c.id in (o.category_id,o.driver_id,o.vehicle_id,o.route_id)
          ))
        )
      )
    )
  );
$$;
revoke all on function public.os_professional_memberships(integer,integer) from public,anon;
revoke all on function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,text,boolean,boolean
) from public,anon;
revoke all on function os_private.is_area_responsible(public.os_orders)
  from public,anon,authenticated;
grant execute on function public.os_professional_memberships(integer,integer) to authenticated;
grant execute on function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,text,boolean,boolean
) to authenticated;
commit;