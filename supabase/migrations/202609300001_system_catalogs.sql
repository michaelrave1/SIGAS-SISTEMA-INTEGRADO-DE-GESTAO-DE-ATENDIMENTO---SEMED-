-- Cadastros do sistema: reaproveita os_catalogs e preserva chaves históricas.
begin;

create table public.os_service_entry_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key=btrim(key) and length(key) between 1 and 80 and key !~ '[[:cntrl:]]'),
  name text not null check (name=btrim(name) and length(name) between 1 and 80),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  active boolean not null default true
);
insert into public.os_service_entry_types(key,name,sort_order) values
 ('diagnóstico','DIAGNÓSTICO',10),('ação realizada','AÇÃO REALIZADA',20),
 ('visita','VISITA',30),('material','MATERIAL',40),('observação técnica','OBSERVAÇÃO TÉCNICA',50);
-- Valores importados continuam válidos para leitura, mas não para novos registros.
insert into public.os_service_entry_types(key,name,active)
 select distinct entry_type,entry_type,false from public.os_order_service_entries
 on conflict(key) do nothing;
alter table public.os_order_service_entries add constraint service_entry_type_fk
 foreign key(entry_type) references public.os_service_entry_types(key) on delete restrict on update restrict;
create index os_order_service_entries_type on public.os_order_service_entries(entry_type);
alter table public.os_order_service_entries add column entry_type_name text
 check (length(entry_type_name) between 1 and 80);

insert into public.os_permissions(key,module,action,description)
 values('system_catalogs.manage','system_catalogs','manage','Administrar os tipos de registro de atendimento.')
 on conflict(key) do nothing;
insert into public.os_access_profile_permissions(access_profile_id,permission_id)
 select p.id,q.id from public.os_access_profiles p cross join public.os_permissions q
 where p.key='admin' and q.key='system_catalogs.manage' on conflict do nothing;

create function os_private.validate_service_entry_type() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
  select name into new.entry_type_name from public.os_service_entry_types where key=new.entry_type and active for share;
  if not found then raise exception 'Tipo de atendimento inválido ou inativo' using errcode='23514'; end if;
  return new;
end; $$;
create trigger service_entry_type_active before insert or update of entry_type
 on public.os_order_service_entries for each row execute function os_private.validate_service_entry_type();

create function public.os_save_service_entry_type(target uuid,type_name text,type_active boolean,type_order integer)
 returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 if not os_private.is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 perform os_private.require_permission('system_catalogs.manage');
 perform pg_advisory_xact_lock(hashtextextended('service_type:'||lower(btrim(type_name)),0));
 if exists(select 1 from public.os_service_entry_types where lower(name)=lower(btrim(type_name)) and id is distinct from target) then
   raise exception 'Tipo já cadastrado' using errcode='23505';
 end if;
 if target is null then
   insert into public.os_service_entry_types(key,name,active,sort_order)
   values(btrim(type_name),upper(btrim(type_name)),type_active,type_order) returning id into saved;
 else
   -- A chave não muda: registros históricos mantêm o texto original.
   update public.os_service_entry_types set name=upper(btrim(type_name)),active=type_active,sort_order=type_order
   where id=target returning id into saved;
   if not found then raise exception 'Cadastro inexistente'; end if;
 end if;
 return saved;
end; $$;
create function public.os_delete_service_entry_type(target uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare type_key text;
begin
 if not os_private.is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 perform os_private.require_permission('system_catalogs.manage');
 select key into type_key from public.os_service_entry_types where id=target for update;
 if exists(select 1 from public.os_audit where entity='os_order_service_entries'
   and type_key in(before_data->>'entry_type',after_data->>'entry_type')) then
   raise exception 'Tipo possui referência histórica' using errcode='23503';
 end if;
 delete from public.os_service_entry_types where id=target;
 if not found then raise exception 'Cadastro inexistente'; end if;
end; $$;

create function public.os_delete_unit(target uuid) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if not os_private.is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 perform os_private.require_permission('units.update');
 perform 1 from public.os_units where id=target for update;
 if not found then raise exception 'Unidade inexistente'; end if;
 if exists(select 1 from public.os_audit where entity in('os_orders','os_memberships')
   and target::text in(before_data->>'unit_id',after_data->>'unit_id',before_data->>'destination_unit_id',after_data->>'destination_unit_id')) then
   raise exception 'Unidade possui referência histórica' using errcode='23503';
 end if;
 delete from public.os_units where id=target;
end; $$;

-- O nome da área é uma chave funcional e de autorização. Não renomear em CRUD.
-- As demais dimensões não podem reclassificar silenciosamente o histórico.
create function os_private.protect_catalog_history() returns trigger
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
 if tg_op='DELETE' and old.kind='logistics' and exists(
   select 1 from public.os_memberships where area=old.data->>'area'
 ) then raise exception 'Área possui vínculos' using errcode='23503'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create trigger catalog_history before update or delete on public.os_catalogs
 for each row execute function os_private.protect_catalog_history();

-- Validação do CRUD público; registros antigos podem ser desativados sem
-- exigir preenchimento retroativo de dimensões ausentes na importação.
create or replace function public.os_save_catalog(
 target uuid,catalog_kind text,catalog_name text,catalog_data jsonb,catalog_active boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare previous_data jsonb;
begin
 if not os_private.is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 perform os_private.require_permission(catalog_kind || case when target is null then '.create' else '.update' end);
 if target is not null then select data into previous_data from public.os_catalogs where id=target for update; end if;
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

create function public.os_delete_catalog(target uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare catalog_kind text;
begin
 if not os_private.is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 select kind into catalog_kind from public.os_catalogs where id=target for update;
 if not found then raise exception 'Cadastro inexistente'; end if;
 perform os_private.require_permission(catalog_kind||'.update');
 delete from public.os_catalogs where id=target;
end; $$;

alter table public.os_service_entry_types enable row level security;
create policy service_types_read on public.os_service_entry_types for select to authenticated
 using(os_private.has_permission('orders.view') or
       (os_private.is_admin() and os_private.has_permission('system_catalogs.manage')));
create trigger service_types_audit after insert or update or delete on public.os_service_entry_types
 for each row execute function os_private.audit_change();

revoke all on public.os_service_entry_types from public,anon,authenticated;
grant select on public.os_service_entry_types to authenticated;
grant all on public.os_service_entry_types to service_role;
revoke all on function os_private.validate_service_entry_type(),os_private.protect_catalog_history() from public,anon,authenticated;
revoke all on function public.os_delete_unit(uuid),public.os_save_service_entry_type(uuid,text,boolean,integer),
 public.os_delete_service_entry_type(uuid),public.os_delete_catalog(uuid) from public,anon,authenticated;
grant execute on function public.os_delete_unit(uuid),public.os_save_service_entry_type(uuid,text,boolean,integer),
 public.os_delete_service_entry_type(uuid),public.os_delete_catalog(uuid) to authenticated;
commit;
