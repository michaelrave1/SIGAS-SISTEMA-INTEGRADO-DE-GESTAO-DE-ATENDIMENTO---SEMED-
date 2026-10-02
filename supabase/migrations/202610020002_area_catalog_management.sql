begin;
create function os_private.can_manage_catalog(catalog_kind text,catalog_data jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select os_private.is_admin() or exists(
 select 1 from public.os_memberships m join public.os_access_profiles p on p.id=m.access_profile_id
 join public.os_professionals professional on professional.id=m.professional_id
 where m.user_id=auth.uid() and m.active and p.active and p.key='area_manager'
 and professional.active and professional.auth_user_id=auth.uid() and (
 (catalog_kind='logistics' and m.area=upper(btrim(catalog_data->>'area')))
 or (catalog_kind in('routes','vehicles','drivers') and m.area='TRANSPORTE ESCOLAR')));
$$;
insert into public.os_access_profile_permissions(access_profile_id,permission_id)
 select p.id,q.id from public.os_access_profiles p cross join public.os_permissions q
 where p.key='area_manager' and q.key in('logistics.view','logistics.create','logistics.update',
 'routes.view','routes.create','routes.update','vehicles.view','vehicles.create','vehicles.update','drivers.view','drivers.create','drivers.update')
 on conflict do nothing;
create function public.os_catalog_management_scope() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('areas',coalesce((select jsonb_agg(distinct m.area) from public.os_memberships m
 join public.os_access_profiles p on p.id=m.access_profile_id join public.os_professionals f on f.id=m.professional_id
 where m.user_id=auth.uid() and m.active and p.active and p.key='area_manager' and f.active and f.auth_user_id=auth.uid()),'[]'::jsonb),
 'kinds',coalesce((select jsonb_agg(k) from unnest(array['logistics','routes','vehicles','drivers']) k
 where os_private.can_manage_catalog(k,jsonb_build_object('area',(select m.area from public.os_memberships m
 join public.os_access_profiles p on p.id=m.access_profile_id where m.user_id=auth.uid() and m.active and p.active and p.key='area_manager' limit 1)))),'[]'::jsonb));
$$;
create policy catalogs_area_management_read on public.os_catalogs for select to authenticated
 using(os_private.can_manage_catalog(kind,data) and os_private.has_permission(kind||'.view'));
create or replace function os_private.os_save_catalog(
  target uuid,
  catalog_kind text,
  catalog_name text,
  catalog_data jsonb,
  catalog_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_id uuid;
begin
  if not os_private.can_manage_catalog(catalog_kind,catalog_data) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if catalog_kind not in ('logistics','routes','vehicles','drivers') or
     length(trim(coalesce(catalog_name,''))) not between 1 and 500 or
     jsonb_typeof(catalog_data) <> 'object' or catalog_active is null then
    raise exception 'Catálogo inválido';
  end if;
  if exists(
    select 1 from jsonb_each(catalog_data) item where jsonb_typeof(item.value) <> 'string'
  ) then raise exception 'Dados de catálogo inválidos'; end if;
  if exists(
    select 1 from jsonb_object_keys(catalog_data) key
    where not case catalog_kind
      when 'logistics' then key in ('area','nature','type','description','detail','options','reminder')
      when 'routes' then key in ('routeId','number','link')
      when 'vehicles' then key in ('plate','model','seats')
      when 'drivers' then key in ('driverId')
      else false
    end
  ) then raise exception 'Campo de catálogo não permitido'; end if;
  if catalog_kind = 'routes' and coalesce(catalog_data ->> 'link','') <> '' and
     catalog_data ->> 'link' !~ '^https?://' then
    raise exception 'Link de rota inválido';
  end if;

  if target is null then
    insert into public.os_catalogs(legacy_id,kind,name,data,active)
    values('NEW-' || gen_random_uuid()::text,catalog_kind,trim(catalog_name),catalog_data,catalog_active)
    returning id into saved_id;
  else
    update public.os_catalogs set
      name = trim(catalog_name), data = catalog_data, active = catalog_active
    where id = target and kind = catalog_kind returning id into saved_id;
    if not found then raise exception 'Catálogo não encontrado'; end if;
  end if;
  return saved_id;
end;
$$;


create or replace function public.os_save_catalog(
 target uuid,catalog_kind text,catalog_name text,catalog_data jsonb,catalog_active boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare previous_data jsonb;
begin
 if not os_private.can_manage_catalog(catalog_kind,catalog_data) then raise exception 'Acesso negado' using errcode='42501'; end if;
 perform os_private.require_permission(catalog_kind || case when target is null then '.create' else '.update' end);
 if target is not null then select data into previous_data from public.os_catalogs where id=target for update;
   if target is not null and not exists(select 1 from public.os_catalogs c where c.id=target and c.kind=catalog_kind and os_private.can_manage_catalog(c.kind,c.data)) then raise exception 'Acesso negado' using errcode='42501'; end if; end if;
 if catalog_kind='logistics' and (target is null or previous_data is distinct from catalog_data) then
   if nullif(btrim(catalog_data->>'area'),'') is null
     or (nullif(btrim(catalog_data->>'type'),'') is not null and nullif(btrim(catalog_data->>'nature'),'') is null)
     or ((nullif(btrim(catalog_data->>'description'),'') is not null or nullif(btrim(catalog_data->>'detail'),'') is not null)
       and nullif(btrim(catalog_data->>'type'),'') is null) then
     raise exception 'Respeite a hierarquia Área, Natureza e Tipo' using errcode='23514';
   end if;
 end if;
 return os_private.os_save_catalog(target,catalog_kind,catalog_name,catalog_data,catalog_active);
end; $$;


create or replace function public.os_delete_catalog(target uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare catalog_kind text; catalog_data jsonb;
begin
 select kind,data into catalog_kind,catalog_data from public.os_catalogs where id=target for update;
 if not found or not os_private.can_manage_catalog(catalog_kind,catalog_data) then raise exception 'Acesso negado' using errcode='42501'; end if;
 perform os_private.require_permission(catalog_kind||'.update');
 delete from public.os_catalogs where id=target;
end; $$;


revoke all on function os_private.can_manage_catalog(text,jsonb) from public,anon;
grant execute on function os_private.can_manage_catalog(text,jsonb) to authenticated;
revoke all on function public.os_catalog_management_scope() from public,anon;
grant execute on function public.os_catalog_management_scope() to authenticated;
create or replace function os_private.protect_catalog_history() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if new.kind='logistics' and new.data ? 'area' then
     new.data=jsonb_set(new.data,'{area}',to_jsonb(upper(btrim(new.data->>'area'))));
   end if;
   if new.kind<>old.kind then raise exception 'Tipo de cadastro imutável' using errcode='23514'; end if;
   if old.kind='logistics' and new.data->>'area' is distinct from old.data->>'area' then
     raise exception 'Área imutável: crie outra classificação' using errcode='23514';
   end if;
   if new.data is not distinct from old.data then return new; end if;
 end if;
 if exists(select 1 from public.os_orders o where old.id in(o.category_id,o.driver_id,o.vehicle_id,o.route_id))
 or exists(select 1 from public.os_audit a where a.entity='os_orders' and
   (old.id::text in(a.before_data->>'category_id',a.before_data->>'driver_id',a.before_data->>'vehicle_id',a.before_data->>'route_id',
                   a.after_data->>'category_id',a.after_data->>'driver_id',a.after_data->>'vehicle_id',a.after_data->>'route_id'))) then
   raise exception 'Cadastro possui referência histórica' using errcode='23503';
 end if;
 if tg_op='DELETE' and old.kind='logistics' and not exists(
   select 1 from public.os_catalogs c where c.id<>old.id and c.kind='logistics' and c.data->>'area'=old.data->>'area'
 ) and exists(
   select 1 from public.os_memberships where area=old.data->>'area'
 ) then raise exception 'Área possui vínculos' using errcode='23503'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;

commit;
