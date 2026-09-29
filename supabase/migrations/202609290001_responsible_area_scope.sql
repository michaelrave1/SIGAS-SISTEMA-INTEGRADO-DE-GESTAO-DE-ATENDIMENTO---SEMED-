-- Vincula responsáveis a uma área do catálogo e limita a leitura de OS a ela.
begin;

update public.os_access_profiles
set name='Gestor da Unidade',
  description='Gestão e acompanhamento conforme o escopo da unidade.'
where key='manager';

drop index public.os_access_profiles_system_legacy_role;
create unique index os_access_profiles_system_key
  on public.os_access_profiles(key) where is_system;

insert into public.os_access_profiles(
  id,key,name,description,active,is_system,legacy_role
) values(
  'a2000000-0000-4000-a000-000000000001','area_manager','Gestor de Área',
  'Realiza a triagem e encaminha Ordens de Serviço da área vinculada.',
  true,true,'gestor'
);

insert into public.os_access_profile_permissions(access_profile_id,permission_id)
select profile.id,permission.id
from public.os_access_profiles profile
join public.os_permissions permission on permission.key=any(array[
  'dashboard.view','orders.view','orders.triage','orders.assign','orders.reassign',
  'units.view','logistics.view'
])
where profile.key='area_manager';

create or replace function os_private.sync_membership_access_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare compatible_role text;
begin
  if tg_op='INSERT' then
    if new.access_profile_id is null then
      select p.id into new.access_profile_id
      from public.os_access_profiles p
      where p.is_system and p.active and p.legacy_role=new.role
      order by (p.key=case new.role
        when 'admin' then 'admin' when 'gestor' then 'manager'
        when 'solicitante' then 'requester' else 'responsible' end) desc
      limit 1;
    else
      select p.legacy_role into compatible_role from public.os_access_profiles p
      where p.id=new.access_profile_id and p.active;
      if compatible_role is null then raise exception 'Perfil de acesso inválido ou inativo'; end if;
      new.role:=compatible_role;
    end if;
  elsif new.access_profile_id is distinct from old.access_profile_id then
    select p.legacy_role into compatible_role from public.os_access_profiles p
    where p.id=new.access_profile_id and p.active;
    if compatible_role is null then raise exception 'Perfil de acesso inválido ou inativo'; end if;
    new.role:=compatible_role;
  elsif new.role is distinct from old.role then
    select p.id into new.access_profile_id from public.os_access_profiles p
    where p.is_system and p.active and p.legacy_role=new.role
    order by (p.key=case new.role
      when 'admin' then 'admin' when 'gestor' then 'manager'
      when 'solicitante' then 'requester' else 'responsible' end) desc
    limit 1;
  end if;
  if new.access_profile_id is null then raise exception 'Perfil de acesso obrigatório'; end if;
  return new;
end;
$$;

update public.os_catalogs
set data=jsonb_set(
  data,'{area}',to_jsonb(upper(btrim(data->>'area'))),true
)
where kind='logistics' and nullif(btrim(data->>'area'),'') is not null
  and data->>'area' is distinct from upper(btrim(data->>'area'));

create function os_private.normalize_catalog_area()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind='logistics' and nullif(btrim(new.data->>'area'),'') is not null then
    new.data:=jsonb_set(
      new.data,'{area}',to_jsonb(upper(btrim(new.data->>'area'))),true
    );
  end if;
  return new;
end;
$$;
create trigger catalogs_normalize_area
  before insert or update of data,kind on public.os_catalogs
  for each row execute function os_private.normalize_catalog_area();

alter table public.os_memberships
  add column area text check (
    area is null or (
      length(btrim(area)) between 1 and 500 and area=upper(btrim(area))
    )
  );

create function os_private.normalize_membership_area()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.area:=nullif(upper(btrim(new.area)),'');
  return new;
end;
$$;
create trigger memberships_normalize_area
  before insert or update of area on public.os_memberships
  for each row execute function os_private.normalize_membership_area();

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

create function os_private.sync_catalog_area_assignments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.os_order_area_assignments assignment
  using public.os_orders o
  where assignment.order_id=o.id and o.category_id=new.id;
  insert into public.os_order_area_assignments(order_id,membership_id)
  select o.id,m.id
  from public.os_orders o
  join public.os_memberships m on m.active and m.role='responsavel'
  where o.category_id=new.id and new.kind='logistics'
    and m.area is not null and m.area=btrim(new.data->>'area')
  on conflict do nothing;
  return new;
end;
$$;

create trigger orders_sync_area_assignments
  after insert or update of category_id on public.os_orders
  for each row execute function os_private.sync_order_area_assignments();
create trigger memberships_sync_area_assignments
  after insert or update of area,role,active on public.os_memberships
  for each row execute function os_private.sync_membership_area_assignments();
create trigger catalogs_sync_area_assignments
  after update of data,kind on public.os_catalogs
  for each row execute function os_private.sync_catalog_area_assignments();

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
    m.unit_id,m.area,
    case when access_profile.key='area_manager' then 'gestor_area' else m.role end,
    m.active,count(*) over()
  from public.os_professionals p
  left join public.os_memberships m on m.professional_id=p.id
  left join public.os_access_profiles access_profile on access_profile.id=m.access_profile_id
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
  normalized_area text := nullif(upper(btrim(target_area)),'');
begin
  perform os_private.require_permission(case
    when not professional_active or not membership_active then 'professionals.delete'
    when target_professional is null then 'professionals.create'
    else 'professionals.update' end);

  if target_role in ('responsavel','gestor_area') and normalized_area is null then
    raise exception 'Área obrigatória para este perfil';
  end if;
  if target_role not in ('responsavel','gestor_area') and normalized_area is not null then
    raise exception 'Área permitida somente para responsável ou gestor de área';
  end if;
  if normalized_area is not null and not exists(
    select 1 from public.os_catalogs c
    where c.kind='logistics' and c.active and btrim(c.data->>'area')=normalized_area
  ) then raise exception 'Área inválida'; end if;

  saved_membership := os_private.os_save_professional_membership(
    target_membership,target_professional,professional_email,professional_name,
    professional_registration,professional_position,
    case when target_role='gestor_area' then null else target_unit end,
    case when target_role='gestor_area' then 'gestor' else target_role end,
    professional_active,membership_active
  );
  update public.os_memberships set area=normalized_area,
    access_profile_id=(select p.id from public.os_access_profiles p where p.key=case
      when target_role='gestor_area' then 'area_manager'
      when target_role='gestor' then 'manager'
      when target_role='admin' then 'admin'
      when target_role='solicitante' then 'requester'
      else 'responsible' end)
  where id=saved_membership;
  return saved_membership;
end;
$$;

create function os_private.is_area_manager(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    join public.os_access_profiles profile on profile.id=m.access_profile_id
    join public.os_catalogs category on category.id=o.category_id
    where m.user_id=(select auth.uid()) and m.active
      and profile.key='area_manager' and profile.active
      and m.area is not null and m.area=btrim(category.data->>'area')
  );
$$;

create or replace function os_private.is_origin_manager(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    join public.os_access_profiles profile on profile.id=m.access_profile_id
    where m.user_id=(select auth.uid()) and m.active and m.role='gestor'
      and profile.key<>'area_manager'
      and (m.unit_id is null or m.unit_id=o.unit_id)
  );
$$;

create or replace function os_private.is_destination_manager(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select o.destination_unit_id is not null and exists(
    select 1 from public.os_memberships m
    join public.os_access_profiles profile on profile.id=m.access_profile_id
    where m.user_id=(select auth.uid()) and m.active and m.role='gestor'
      and profile.key<>'area_manager'
      and (m.unit_id is null or m.unit_id=o.destination_unit_id)
  );
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
      join public.os_access_profiles profile on profile.id=m.access_profile_id
      join public.os_catalogs category on category.id=o.category_id
      where m.user_id=(select auth.uid()) and m.active
        and profile.key='area_manager' and m.area=btrim(category.data->>'area')
      order by m.id limit 1
    ),
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

create or replace function os_private.is_assigned_responsible(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.os_memberships m
    where m.id=o.responsible_membership_id
      and m.user_id=(select auth.uid()) and m.active
      and m.role='responsavel' and o.responsible_id=m.user_id
  );
$$;

create or replace function os_private.can_service_order(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select os_private.is_admin() or os_private.is_assigned_responsible(o);
$$;

create or replace function os_private.os_start_triage(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype; actor_membership uuid;
begin
  current_order:=os_private.lock_order(target,expected_version);
  if not (os_private.is_admin() or os_private.is_area_manager(current_order)) then
    raise exception 'Acesso negado';
  end if;
  if current_order.status <> 'Aberta' then
    raise exception 'Triagem não permitida no status atual';
  end if;
  if not os_private.order_is_reconciled(current_order) then
    raise exception 'Ordem não conciliada';
  end if;
  actor_membership:=os_private.order_actor_membership(current_order);
  update public.os_orders set status='Em triagem',triaged_at=now(),version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(target,current_order.status,'Em triagem',
    'triage_started','start_triage','',actor_membership,
    jsonb_build_object('version',expected_version+1));
end;
$$;

create or replace function os_private.os_assign_order(
  target uuid,expected_version bigint,responsible_membership uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  assignee public.os_memberships%rowtype;
  actor_membership uuid;
  next_status text;
begin
  current_order:=os_private.lock_order(target,expected_version);
  if not (os_private.is_admin() or os_private.is_area_manager(current_order)) then
    raise exception 'Acesso negado';
  end if;
  if current_order.status not in ('Em triagem','Encaminhada') then
    raise exception 'Encaminhamento não permitido no status atual';
  end if;
  select m.* into assignee
  from public.os_memberships m
  where m.id=responsible_membership and m.active and m.role='responsavel'
    and m.user_id is not null and (
      exists(select 1 from public.os_order_area_assignments assignment
        where assignment.membership_id=m.id and assignment.order_id=current_order.id)
      or (m.area is null and m.unit_id=coalesce(
        current_order.destination_unit_id,current_order.unit_id
      ))
    );
  if not found then raise exception 'O profissional não pertence à área da OS'; end if;
  actor_membership:=os_private.order_actor_membership(current_order);
  -- Compatibilidade: OSs que já passaram pelo antigo encaminhamento para
  -- unidade concluem a atribuição. No fluxo atual, a triagem encaminha
  -- diretamente ao profissional e aguarda o aceite dele.
  next_status:=case when current_order.status='Encaminhada'
    then 'Atribuída' else 'Encaminhada' end;
  update public.os_orders set responsible_id=assignee.user_id,
    responsible_membership_id=assignee.id,destination_unit_id=assignee.unit_id,
    status=next_status,
    assigned_at=case when next_status='Atribuída' then now() else null end,
    version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(
    target,current_order.status,next_status,
    case when next_status='Atribuída' then 'order_assigned' else 'order_forwarded' end,
    case when next_status='Atribuída' then 'assign' else 'forward' end,'',
    actor_membership,jsonb_build_object(
      'responsible_membership_id',assignee.id,'version',expected_version+1
    )
  );
end;
$$;

create or replace function os_private.os_accept_assignment(
  target uuid,expected_version bigint
) returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype; actor_membership uuid;
begin
  current_order:=os_private.lock_order(target,expected_version);
  if current_order.status <> 'Encaminhada' then
    raise exception 'Aceite não permitido no status atual';
  end if;
  if not os_private.is_assigned_responsible(current_order) then
    raise exception 'Somente o profissional indicado pode aceitar a atribuição';
  end if;
  actor_membership:=os_private.order_actor_membership(current_order);
  update public.os_orders set status='Atribuída',assigned_at=now(),version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(
    target,'Encaminhada','Atribuída','order_assigned','assign','',
    actor_membership,jsonb_build_object('version',expected_version+1)
  );
end;
$$;

create or replace function public.os_accept_assignment(
  target uuid,expected_version bigint
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform os_private.os_accept_assignment(target,expected_version);
end;
$$;

create or replace function os_private.os_reassign_order(
  target uuid,expected_version bigint,responsible_membership uuid,
  justification text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  assignee public.os_memberships%rowtype;
  actor_membership uuid;
  normalized_reason text:=btrim(coalesce(justification,''));
begin
  current_order:=os_private.lock_order(target,expected_version);
  if not (os_private.is_admin() or os_private.is_area_manager(current_order)) then
    raise exception 'Acesso negado';
  end if;
  if current_order.status not in ('Encaminhada','Atribuída') then
    raise exception 'Reatribuição não permitida no status atual';
  end if;
  if length(normalized_reason) not between 3 and 2000 then
    raise exception 'Justificativa obrigatória';
  end if;
  select m.* into assignee
  from public.os_memberships m
  where m.id=responsible_membership and m.active and m.role='responsavel'
    and m.user_id is not null and (
      exists(select 1 from public.os_order_area_assignments assignment
        where assignment.membership_id=m.id and assignment.order_id=current_order.id)
      or (m.area is null and m.unit_id=coalesce(
        current_order.destination_unit_id,current_order.unit_id
      ))
    );
  if not found or assignee.id=current_order.responsible_membership_id then
    raise exception 'Novo profissional responsável inválido para a área da OS';
  end if;
  actor_membership:=os_private.order_actor_membership(current_order);
  update public.os_orders set responsible_id=assignee.user_id,
    responsible_membership_id=assignee.id,destination_unit_id=assignee.unit_id,
    status='Encaminhada',assigned_at=null,version=version+1
  where id=target and version=expected_version;
  if not found then raise exception 'Conflito de versão'; end if;
  perform os_private.record_order_event(
    target,current_order.status,'Encaminhada','order_reassigned',
    'reassign',normalized_reason,actor_membership,jsonb_build_object(
      'previous_membership_id',current_order.responsible_membership_id,
      'responsible_membership_id',assignee.id,'version',expected_version+1
    )
  );
end;
$$;

alter table public.os_orders
  drop constraint os_orders_responsible_during_service_check;

create or replace function os_private.os_start_service(target uuid,expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype; actor_membership uuid;
begin
  current_order := os_private.lock_order(target,expected_version);
  if current_order.status <> 'Atribuída' then
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
  area_manager boolean;
  service_actor boolean;
begin
  if auth.uid() is null then return; end if;
  select o.* into current_order from public.os_orders o
  where o.id=target and o.active;
  if not found then return; end if;
  administrator := os_private.is_admin();
  area_manager := os_private.is_area_manager(current_order);
  service_actor := os_private.can_service_order(current_order);

  if current_order.status='A conferir' and administrator then operation:='RECONCILE'; return next; end if;
  if current_order.status='Aberta' and (administrator or area_manager) then operation:='TRIAGE'; return next; end if;
  if current_order.status='Em triagem' and (administrator or area_manager) then operation:='ASSIGN'; return next; end if;
  if current_order.status='Encaminhada' and (administrator or area_manager) then
    operation:=case when current_order.responsible_membership_id is null
      then 'ASSIGN' else 'REASSIGN' end;
    return next;
  end if;
  if current_order.status='Atribuída' and (administrator or area_manager) then operation:='REASSIGN'; return next; end if;
  if current_order.status='Encaminhada'
    and os_private.is_assigned_responsible(current_order) then
    operation:='ACCEPT_ASSIGNMENT'; return next;
  end if;
  if current_order.status='Atribuída' and service_actor then
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
    or os_private.is_area_manager(o)
    or os_private.is_origin_manager(o)
    or os_private.is_destination_manager(o)
    or os_private.is_area_responsible(o)
    or os_private.is_assigned_responsible(o)
  );
$$;

create function public.os_order_responsible_options(target uuid)
returns table(id uuid,user_id uuid,name text)
language plpgsql stable security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype;
begin
  perform os_private.require_permission('orders.assign');
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

create or replace function public.os_order_available_actions(target uuid)
returns table(operation text)
language sql stable security definer set search_path = '' as $$
  select available.operation
  from os_private.os_order_available_actions(target) available
  where os_private.has_permission(case available.operation
    when 'RECONCILE' then 'orders.update'
    when 'TRIAGE' then 'orders.triage'
    when 'FORWARD' then 'orders.forward'
    when 'ASSIGN' then 'orders.assign'
    when 'ACCEPT_ASSIGNMENT' then 'orders.attend'
    when 'REASSIGN' then 'orders.reassign'
    when 'START_SERVICE' then 'orders.attend'
    when 'ADD_SERVICE_ENTRY' then 'orders.attend'
    when 'WAIT_INFORMATION' then 'orders.wait_information'
    when 'RESUME' then 'orders.resume'
    when 'COMPLETE' then 'orders.complete'
    when 'CANCEL' then 'orders.cancel'
    when 'REOPEN' then 'orders.reopen'
    when 'EDIT' then 'orders.update'
    else '__invalid__'
  end);
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
        or os_private.is_area_manager(o)
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
          (m.role='gestor' and m.unit_id is null and not exists(
            select 1 from public.os_access_profiles profile
            where profile.id=m.access_profile_id and profile.key='area_manager'
          )) or
          (exists(select 1 from public.os_access_profiles profile
             where profile.id=m.access_profile_id and profile.key='area_manager')
           and m.area is not null and c.kind='logistics'
           and btrim(c.data->>'area')=m.area) or
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
revoke all on function public.os_order_responsible_options(uuid) from public,anon;
revoke all on function public.os_accept_assignment(uuid,bigint) from public,anon;
revoke all on function os_private.os_accept_assignment(uuid,bigint)
  from public,anon,authenticated;
revoke all on function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,text,boolean,boolean
) from public,anon;
revoke all on function os_private.is_area_responsible(public.os_orders)
  from public,anon,authenticated;
revoke all on function os_private.sync_order_area_assignments()
  from public,anon,authenticated;
revoke all on function os_private.sync_membership_area_assignments()
  from public,anon,authenticated;
revoke all on function os_private.normalize_catalog_area()
  from public,anon,authenticated;
revoke all on function os_private.normalize_membership_area()
  from public,anon,authenticated;
revoke all on function os_private.sync_catalog_area_assignments()
  from public,anon,authenticated;
grant execute on function public.os_professional_memberships(integer,integer) to authenticated;
grant execute on function public.os_order_responsible_options(uuid) to authenticated;
grant execute on function public.os_accept_assignment(uuid,bigint) to authenticated;
grant execute on function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,text,boolean,boolean
) to authenticated;

commit;
