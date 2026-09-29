-- Vincula responsáveis a uma área do catálogo e limita a leitura de OS a ela.
begin;

alter table public.os_memberships
  add column area text check (area is null or length(btrim(area)) between 1 and 500);

create index os_memberships_responsible_area
  on public.os_memberships(area,user_id)
  where active and role='responsavel' and area is not null;

create table public.os_order_area_assignments (
  order_id uuid not null references public.os_orders(id) on delete cascade,
  membership_id uuid not null references public.os_memberships(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(order_id,membership_id)
);
create index os_order_area_assignments_membership
  on public.os_order_area_assignments(membership_id,order_id);
alter table public.os_order_area_assignments enable row level security;
revoke all on public.os_order_area_assignments from public,anon,authenticated;

create function os_private.sync_order_area_assignments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.os_order_area_assignments where order_id=new.id;
  insert into public.os_order_area_assignments(order_id,membership_id)
  select new.id,m.id
  from public.os_memberships m
  join public.os_catalogs c on c.id=new.category_id and c.kind='logistics'
  where m.active and m.role='responsavel' and m.area is not null
    and m.area=btrim(c.data->>'area')
  on conflict do nothing;
  return new;
end;
$$;

create function os_private.sync_membership_area_assignments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.os_order_area_assignments where membership_id=new.id;
  if new.active and new.role='responsavel' and new.area is not null then
    insert into public.os_order_area_assignments(order_id,membership_id)
    select o.id,new.id
    from public.os_orders o
    join public.os_catalogs c on c.id=o.category_id and c.kind='logistics'
    where btrim(c.data->>'area')=new.area
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger orders_sync_area_assignments
  after insert or update of category_id on public.os_orders
  for each row execute function os_private.sync_order_area_assignments();
create trigger memberships_sync_area_assignments
  after insert or update of area,role,active on public.os_memberships
  for each row execute function os_private.sync_membership_area_assignments();

insert into public.os_order_area_assignments(order_id,membership_id)
select o.id,m.id
from public.os_orders o
join public.os_catalogs c on c.id=o.category_id and c.kind='logistics'
join public.os_memberships m on m.active and m.role='responsavel'
  and m.area is not null and m.area=btrim(c.data->>'area')
on conflict do nothing;

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
    join public.os_order_area_assignments assignment
      on assignment.membership_id=m.id and assignment.order_id=o.id
    where m.user_id=(select auth.uid()) and m.active
      and m.role='responsavel' and m.area is not null
  );
$$;

create or replace function os_private.order_actor_membership(o public.os_orders)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select m.id from public.os_memberships m
      join public.os_order_area_assignments assignment
        on assignment.membership_id=m.id and assignment.order_id=o.id
      where m.user_id=(select auth.uid()) and m.active and m.role='responsavel'
      order by m.id limit 1
    ),
    (
      select m.id from public.os_memberships m
      where m.id=o.responsible_membership_id
        and m.user_id=(select auth.uid()) and m.active
      limit 1
    ),
    (
      select m.id from public.os_memberships m
      where m.user_id=(select auth.uid()) and m.active
        and m.role='admin' and m.unit_id is null
      order by m.id limit 1
    )
  );
$$;

create or replace function os_private.can_service_order(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.is_admin() or os_private.is_area_responsible(o)
    or os_private.is_assigned_responsible(o);
$$;

alter table public.os_orders
  drop constraint os_orders_responsible_during_service_check;

create or replace function os_private.os_start_service(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype; actor_membership uuid;
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status not in ('Encaminhada','Atribuída') then
    raise exception 'Atendimento não permitido no status atual';
  end if;
  if not os_private.can_service_order(current_order) then
    raise exception 'Responsável não autorizado';
  end if;
  actor_membership := os_private.order_actor_membership(current_order);
  if actor_membership is null then raise exception 'Vínculo do autor não encontrado'; end if;
  update public.os_orders set status='Em atendimento',service_started_at=now(),
    version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Em atendimento',
    'service_started','start_service','',actor_membership,
    jsonb_build_object('version',expected_version+1));
end;
$$;

create or replace function os_private.os_order_available_actions(target uuid)
returns table(operation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  administrator boolean;
  service_actor boolean;
  area_actor boolean;
begin
  if auth.uid() is null then return; end if;
  select o.* into current_order from public.os_orders o
  where o.id=target and o.active;
  if not found then return; end if;
  administrator := os_private.is_admin();
  service_actor := os_private.can_service_order(current_order);
  area_actor := os_private.is_area_responsible(current_order);

  if current_order.status='A conferir' and administrator then operation:='RECONCILE'; return next; end if;
  if current_order.status='Aberta' and administrator then operation:='TRIAGE'; return next; end if;
  if current_order.status='Em triagem' and administrator then operation:='FORWARD'; return next; end if;
  if current_order.status='Encaminhada' and administrator then operation:='ASSIGN'; return next; end if;
  if current_order.status='Atribuída' and administrator then operation:='REASSIGN'; return next; end if;
  if (current_order.status='Encaminhada' and area_actor)
    or (current_order.status='Atribuída' and service_actor) then
    operation:='START_SERVICE'; return next;
  end if;
  if current_order.status='Em atendimento' and service_actor then
    operation:='ADD_SERVICE_ENTRY'; return next;
    operation:='WAIT_INFORMATION'; return next;
  end if;
  if current_order.status='Atribuída' and service_actor then
    operation:='WAIT_INFORMATION'; return next;
  end if;
  if current_order.status in ('Em triagem','Encaminhada') and administrator then
    operation:='WAIT_INFORMATION'; return next;
  end if;
  if current_order.status='Aguardando informação'
    and current_order.resume_status in ('Atribuída','Em atendimento')
    and service_actor then operation:='RESUME'; return next;
  end if;
  if current_order.status='Aguardando informação'
    and current_order.resume_status in ('Em triagem','Encaminhada')
    and administrator then operation:='RESUME'; return next;
  end if;
  if current_order.status='Em atendimento' and service_actor and exists(
    select 1 from public.os_order_service_entries e where e.order_id=current_order.id
  ) then operation:='COMPLETE'; return next; end if;
  if (current_order.status in ('Atribuída','Em atendimento')
      or (current_order.status='Aguardando informação'
        and current_order.resume_status in ('Atribuída','Em atendimento')))
    and service_actor then
    operation:='CANCEL'; return next;
  elsif current_order.status not in ('Concluída','Cancelada') and administrator then
    operation:='CANCEL'; return next;
  end if;
  if current_order.status in ('Concluída','Cancelada')
    and os_private.order_is_reconciled(current_order)
    and (administrator or service_actor) then operation:='REOPEN'; return next;
  end if;
  if current_order.status not in ('Concluída','Cancelada') and administrator then
    operation:='EDIT'; return next;
  end if;
end;
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

-- O vínculo coletivo da área autoriza colaboração e mantém o ator individual
-- registrado pelo membership que executou cada operação.
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
        or os_private.is_area_responsible(o)
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
revoke all on function os_private.sync_order_area_assignments()
  from public,anon,authenticated;
revoke all on function os_private.sync_membership_area_assignments()
  from public,anon,authenticated;
grant execute on function public.os_professional_memberships(integer,integer) to authenticated;
grant execute on function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,text,boolean,boolean
) to authenticated;

commit;
