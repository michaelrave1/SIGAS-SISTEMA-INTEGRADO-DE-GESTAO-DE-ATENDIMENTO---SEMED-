-- Configura somente apresentação; a matriz e as RPCs do workflow permanecem intactas.
begin;
create table public.os_service_action_settings (
 id uuid primary key default gen_random_uuid(),
 operation text not null unique check(operation in('ACCEPT_ASSIGNMENT','START_SERVICE','RESUME','IMPEDIMENT','PENDING','REQUEST_INFORMATION','REQUEST_FORWARDING','OPERATIONAL_UPDATE','RETURN_TRIAGE','ADD_SERVICE_ENTRY','COMPLETE','RESOLVE')),
 name text not null check(length(btrim(name)) between 1 and 100),
 sort_order integer not null check(sort_order between 0 and 9999)
);
insert into public.os_service_action_settings(operation,name,sort_order) values
 ('ACCEPT_ASSIGNMENT','Assumir atendimento',0),('START_SERVICE','Iniciar atendimento',1),
 ('RESUME','Retomar atendimento',2),('IMPEDIMENT','Registrar impedimento',3),
 ('PENDING','Registrar pendência',4),('REQUEST_INFORMATION','Solicitar informação ao solicitante',5),
 ('REQUEST_FORWARDING','Solicitar reencaminhamento ao gestor da área',6),
 ('OPERATIONAL_UPDATE','Atualizar informações operacionais',7),('RETURN_TRIAGE','Devolver à triagem',8),
 ('ADD_SERVICE_ENTRY','Adicionar registro de atendimento',9),('COMPLETE','Encerramento do atendimento',10),
 ('RESOLVE','Resolver pendência ou impedimento',11);
alter table public.os_service_action_settings enable row level security;
create policy service_action_settings_read on public.os_service_action_settings
 for select to authenticated using(os_private.has_permission('orders.view') or
 (os_private.is_admin() and os_private.has_permission('system_catalogs.manage')));
revoke all on public.os_service_action_settings from anon,authenticated;
grant select on public.os_service_action_settings to authenticated;
create trigger service_action_settings_audit after update on public.os_service_action_settings
 for each row execute function os_private.audit_change();

create function public.os_service_action_catalog()
 returns table(operation text,name text,sort_order integer,states text[],permission text)
 language plpgsql stable security definer set search_path='' as $$
begin
 if not (os_private.has_permission('orders.view') or
 (os_private.is_admin() and os_private.has_permission('system_catalogs.manage'))) then
  raise exception 'Acesso negado' using errcode='42501';
 end if;
 return query select s.operation,s.name,s.sort_order,m.states,m.permission
 from public.os_service_action_settings s join os_private.service_workflow_matrix() m on m.action=s.operation
 order by s.sort_order,s.operation;
end; $$;
create function public.os_save_service_action_setting(target_operation text,action_name text,action_order integer)
 returns void language plpgsql security definer set search_path='' as $$
begin
 if not (os_private.is_admin() and os_private.has_permission('system_catalogs.manage')) then
  raise exception 'Acesso negado' using errcode='42501';
 end if;
 if action_name is null or length(btrim(action_name)) not between 1 and 100
 or action_order is null or action_order not between 0 and 9999 then
  raise exception 'Dados inválidos' using errcode='23514';
 end if;
 update public.os_service_action_settings set name=btrim(action_name),sort_order=action_order
 where operation=target_operation and (name,sort_order) is distinct from (btrim(action_name),action_order);
 if not exists(select 1 from public.os_service_action_settings where operation=target_operation) then
  raise exception 'Ação inexistente' using errcode='23514';
 end if;
end; $$;
revoke all on function public.os_service_action_catalog(),public.os_save_service_action_setting(text,text,integer) from public,anon;
grant execute on function public.os_service_action_catalog(),public.os_save_service_action_setting(text,text,integer) to authenticated;
commit;
