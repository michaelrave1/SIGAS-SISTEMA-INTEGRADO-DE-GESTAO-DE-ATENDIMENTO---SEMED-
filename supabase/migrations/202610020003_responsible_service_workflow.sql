-- Extensão do atendimento existente. Registros operacionais são atendimentos
-- imutáveis; sua resolução é outro registro, nunca uma alteração do histórico.
begin;
alter table public.os_order_service_entries
 add column operational_kind text check(operational_kind in('impediment','pending','resolve','request_information','request_forwarding','operational_update','return_triage')),
 add column related_entry_id bigint,
 add constraint service_related_entry_same_order foreign key(related_entry_id,order_id) references public.os_order_service_entries(id,order_id),
 add constraint service_resolution_reference check(coalesce(operational_kind='resolve',false)=(related_entry_id is not null));
create unique index service_issue_single_resolution on public.os_order_service_entries(related_entry_id) where operational_kind='resolve';
alter table public.os_orders
 add column service_summary text check(service_summary is null or length(btrim(service_summary)) between 3 and 5000),
 add column final_observations text check(final_observations is null or length(final_observations)<=5000);
create index service_open_issue_lookup on public.os_order_service_entries(order_id,id) where operational_kind in('pending','impediment');
alter table public.os_messages add column request_id uuid;
create unique index message_request_id on public.os_messages(author_id,request_id) where request_id is not null;

insert into public.os_permissions(key,module,action,description)
 values('orders.return_triage','orders','return_triage','Devolver a OS à triagem com justificativa.') on conflict(key) do nothing;
insert into public.os_access_profile_permissions(access_profile_id,permission_id)
 select p.id,q.id from public.os_access_profiles p cross join public.os_permissions q
 where p.key in('admin','responsible','area_manager') and q.key='orders.return_triage' on conflict do nothing;

-- Matriz única consultada pela interface e pelos comandos no servidor.
create function os_private.service_workflow_matrix()
 returns table(action text,states text[],permission text) language sql immutable set search_path='' as $$
 values
 ('ACCEPT_ASSIGNMENT',array['Encaminhada'],'orders.attend'),
 ('START_SERVICE',array['Atribuída'],'orders.attend'),
 ('ADD_SERVICE_ENTRY',array['Em atendimento'],'orders.attend'),
 ('WAIT_INFORMATION',array['Atribuída','Em atendimento'],'orders.wait_information'),
 ('RESUME',array['Aguardando informação'],'orders.resume'),
 ('COMPLETE',array['Em atendimento'],'orders.complete'),
 ('IMPEDIMENT',array['Atribuída','Em atendimento','Aguardando informação'],'orders.attend'),
 ('PENDING',array['Atribuída','Em atendimento','Aguardando informação'],'orders.attend'),
 ('RESOLVE',array['Atribuída','Em atendimento','Aguardando informação'],'orders.attend'),
 ('REQUEST_INFORMATION',array['Atribuída','Em atendimento'],'orders.wait_information'),
 ('REQUEST_FORWARDING',array['Atribuída','Em atendimento','Aguardando informação'],'orders.attend'),
 ('OPERATIONAL_UPDATE',array['Em atendimento'],'orders.attend'),
 ('RETURN_TRIAGE',array['Encaminhada','Atribuída','Em atendimento','Aguardando informação'],'orders.return_triage');
$$;
create function os_private.has_open_service_issues(target uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.os_order_service_entries e where e.order_id=target
 and e.operational_kind in('impediment','pending') and not exists(
 select 1 from public.os_order_service_entries r where r.related_entry_id=e.id and r.operational_kind='resolve'));
$$;
create function os_private.service_action_allowed(o public.os_orders, requested_action text)
 returns boolean language sql stable security definer set search_path='' as $$
 select o.active and os_private.can_read_order(o) and exists(
 select 1 from os_private.service_workflow_matrix() m where m.action=requested_action
 and o.status=any(m.states) and os_private.has_permission(m.permission))
 and (os_private.is_admin() or (os_private.is_assigned_responsible(o) and exists(
 select 1 from public.os_memberships m join public.os_catalogs c on c.id=o.category_id
 where m.id=o.responsible_membership_id and (m.area=c.data->>'area' or
 (m.area is null and m.unit_id=coalesce(o.destination_unit_id,o.unit_id)))))
 or (requested_action='RETURN_TRIAGE' and os_private.is_area_manager(o)))
 and (os_private.is_admin() or not exists(select 1 from public.os_order_dispatches d
 where d.os_id=o.id and d.usuario_destino_id=auth.uid() and d.ciente_em is null))
 and (requested_action<>'ACCEPT_ASSIGNMENT' or os_private.is_assigned_responsible(o))
 and (requested_action<>'RESUME' or o.resume_status in('Atribuída','Em atendimento'))
 and (requested_action<>'COMPLETE' or (not os_private.has_open_service_issues(o.id) and exists(
 select 1 from public.os_order_service_entries e where e.order_id=o.id and e.operational_kind is null)));
$$;
create function os_private.require_service_action(o public.os_orders,requested_action text) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if os_private.service_action_allowed(o,requested_action) is not true then
  raise exception 'Ação não permitida: verifique ciência, estado, pendências e autorização' using errcode='42501';
 end if;
end; $$;

-- Não substitui a matriz de triagem/gestão já existente.
alter function os_private.os_order_available_actions(uuid) rename to management_order_available_actions;
create function os_private.os_order_available_actions(target uuid) returns table(operation text)
 language sql stable security definer set search_path='' as $$
 select b.operation from os_private.management_order_available_actions(target) b
 join public.os_orders o on o.id=target
 where not exists(select 1 from os_private.service_workflow_matrix() m where m.action=b.operation)
 or os_private.service_action_allowed(o,b.operation)
 or (os_private.is_admin() and b.operation in('WAIT_INFORMATION','RESUME'))
 union all
 select m.action from os_private.service_workflow_matrix() m join public.os_orders o on o.id=target
 where os_private.service_action_allowed(o,m.action)
 and not exists(select 1 from os_private.management_order_available_actions(target) b where b.operation=m.action);
$$;
create or replace function public.os_order_available_actions(target uuid) returns table(operation text)
 language sql stable security definer set search_path='' as $$
 select a.operation from os_private.os_order_available_actions(target) a
 where os_private.has_permission(coalesce((select m.permission from os_private.service_workflow_matrix() m where m.action=a.operation),
 case a.operation when 'RECONCILE' then 'orders.update' when 'TRIAGE' then 'orders.triage'
 when 'FORWARD' then 'orders.forward' when 'ASSIGN' then 'orders.assign' when 'REASSIGN' then 'orders.reassign'
 when 'CANCEL' then 'orders.cancel' when 'REOPEN' then 'orders.reopen' when 'EDIT' then 'orders.update' else '__invalid__' end));
$$;

-- Reutiliza as RPCs transacionais, acrescentando a matriz/ciência no acesso.
create or replace function public.os_accept_assignment(target uuid,expected_version bigint) returns void
 language plpgsql security definer set search_path='' as $$
declare o public.os_orders;
begin o:=os_private.lock_order(target,expected_version); perform os_private.require_service_action(o,'ACCEPT_ASSIGNMENT');
 perform os_private.os_accept_assignment(target,expected_version); end; $$;
create or replace function public.os_start_service(target uuid,expected_version bigint) returns void
 language plpgsql security definer set search_path='' as $$
declare o public.os_orders;
begin o:=os_private.lock_order(target,expected_version); perform os_private.require_service_action(o,'START_SERVICE');
 perform os_private.os_start_service(target,expected_version); end; $$;
create or replace function public.os_add_service_entry(target uuid,expected_version bigint,entry_kind text,entry_description text,serviced_on timestamptz) returns bigint
 language plpgsql security definer set search_path='' as $$
declare o public.os_orders;
begin o:=os_private.lock_order(target,expected_version); perform os_private.require_service_action(o,'ADD_SERVICE_ENTRY');
 return os_private.os_add_service_entry(target,expected_version,entry_kind,entry_description,serviced_on); end; $$;
create or replace function public.os_wait_for_information(target uuid,expected_version bigint,wait_reason text,wait_details text) returns void
 language plpgsql security definer set search_path='' as $$
declare o public.os_orders;
begin o:=os_private.lock_order(target,expected_version);
 if os_private.is_admin() and o.status in('Em triagem','Encaminhada') then perform os_private.require_permission('orders.wait_information');
 else perform os_private.require_service_action(o,'WAIT_INFORMATION'); end if;
 perform os_private.os_wait_for_information(target,expected_version,wait_reason,wait_details); end; $$;
create or replace function public.os_resume_service(target uuid,expected_version bigint) returns void
 language plpgsql security definer set search_path='' as $$
declare o public.os_orders;
begin o:=os_private.lock_order(target,expected_version);
 if os_private.is_admin() and o.resume_status in('Em triagem','Encaminhada') then perform os_private.require_permission('orders.resume');
 else perform os_private.require_service_action(o,'RESUME'); end if;
 perform os_private.os_resume_service(target,expected_version);
 -- O evento existente passa a preservar o período completo da espera.
 perform os_private.record_order_event(target,o.status,o.resume_status,'wait_period_closed',null,o.waiting_details,
 os_private.order_actor_membership(o),jsonb_build_object('waiting_since',o.waiting_since,'resumed_at',statement_timestamp(),'waiting_reason',o.waiting_reason));
end; $$;

create function public.os_service_operation(target uuid,expected_version bigint,service_action text,description text,entry_kind text,related_entry bigint default null,material_status text default null)
 returns bigint language plpgsql security definer set search_path='' as $$
declare o public.os_orders; entry bigint; kind text; event_name text; next_status text; actor_membership uuid;
begin
 o:=os_private.lock_order(target,expected_version);
 perform os_private.require_service_action(o,service_action);
 if length(btrim(coalesce(description,''))) not between 3 and 2000 then raise exception 'Descrição obrigatória' using errcode='22023'; end if;
 kind:=case service_action when 'IMPEDIMENT' then 'impediment' when 'PENDING' then 'pending' when 'RESOLVE' then 'resolve'
 when 'REQUEST_INFORMATION' then 'request_information' when 'REQUEST_FORWARDING' then 'request_forwarding'
 when 'OPERATIONAL_UPDATE' then 'operational_update' when 'RETURN_TRIAGE' then 'return_triage' end;
 if kind is null then raise exception 'Operação inválida' using errcode='22023'; end if;
 if kind='resolve' then
  if not exists(select 1 from public.os_order_service_entries e where e.id=related_entry and e.order_id=target and e.operational_kind in('impediment','pending'))
   or exists(select 1 from public.os_order_service_entries e where e.related_entry_id=related_entry) then raise exception 'Pendência inválida ou já resolvida' using errcode='22023'; end if;
 elsif related_entry is not null then raise exception 'Referência incompatível' using errcode='22023'; end if;
 if kind='operational_update' and (material_status is null or material_status not in('Sim','Não','Não informado')) then raise exception 'Situação do material inválida' using errcode='22023'; end if;
 if kind='request_information' and o.opened_by is null then raise exception 'Solicitante não identificado' using errcode='22023'; end if;
 actor_membership:=os_private.order_actor_membership(o);
 if actor_membership is null then select m.id into actor_membership from public.os_memberships m where m.user_id=auth.uid() and m.active and m.area=(select c.data->>'area' from public.os_catalogs c where c.id=o.category_id) limit 1; end if;
 insert into public.os_order_service_entries(order_id,author_id,author_membership_id,entry_type,description,serviced_at,operational_kind,related_entry_id)
 values(target,auth.uid(),actor_membership,entry_kind,btrim(description),statement_timestamp(),kind,related_entry) returning id into entry;
 next_status:=case kind when 'request_information' then 'Aguardando informação' when 'return_triage' then 'Em triagem' else o.status end;
 if kind='request_information' then
  insert into public.os_messages(order_id,author_id,body) values(target,auth.uid(),'SOLICITAÇÃO DE INFORMAÇÃO: '||btrim(description));
  perform os_private.os_wait_for_information(target,expected_version,'solicitante',description);
 elsif kind='return_triage' then
  update public.os_orders set status='Em triagem',responsible_id=null,responsible_membership_id=null,destination_unit_id=null,assigned_at=null,
   waiting_since=null,waiting_reason=null,waiting_details=null,resume_status=null,version=version+1 where id=target;
 else
  update public.os_orders set version=version+1,
   details=case when kind='operational_update' then details||jsonb_build_object('has_material',material_status,'operational_observation',btrim(description)) else details end where id=target;
 end if;
 event_name:=case kind when 'impediment' then 'service_impediment' when 'pending' then 'service_pending' when 'resolve' then 'service_issue_resolved'
 when 'request_information' then 'information_requested' when 'request_forwarding' then 'forwarding_requested'
 when 'return_triage' then 'order_returned_triage' else 'operational_information_updated' end;
 perform os_private.record_order_event(target,o.status,next_status,event_name,case when kind='return_triage' then 'return_to_triage' else null end,btrim(description),actor_membership,
 jsonb_build_object('service_entry_id',entry,'related_entry_id',related_entry,'recipient_id',case when kind='request_information' then o.opened_by end,
 'previous_responsible_id',o.responsible_id,'previous_membership_id',o.responsible_membership_id,'material_status',material_status,'version',expected_version+1));
 return entry;
end; $$;

-- A assinatura antiga deixa de permitir contornar os campos da conclusão.
create function public.os_order_open_service_issues(target uuid)
 returns table(id bigint,description text,operational_kind text)
 language sql stable security definer set search_path='' as $$
 select e.id,e.description,e.operational_kind from public.os_order_service_entries e
 join public.os_orders o on o.id=e.order_id where o.id=target and o.active
 and os_private.can_read_order_internal(o) and e.operational_kind in('impediment','pending')
 and not exists(select 1 from public.os_order_service_entries r where r.related_entry_id=e.id and r.operational_kind='resolve')
 order by e.created_at,e.id;
$$;
create or replace function public.os_complete_order(target uuid,expected_version bigint,solution text) returns void
 language plpgsql security definer set search_path='' as $$
begin perform os_private.require_permission('orders.complete'); raise exception 'Informe resumo do serviço e solução' using errcode='22023'; end; $$;
create or replace function public.os_complete_order(target uuid,solution text) returns void
 language plpgsql security definer set search_path='' as $$
begin perform os_private.require_permission('orders.complete'); raise exception 'Informe versão, resumo do serviço e solução' using errcode='22023'; end; $$;
create or replace function public.os_reopen_order(target uuid,expected_version bigint,justification text) returns void
 language plpgsql security definer set search_path='' as $$
begin
 perform os_private.require_permission('orders.reopen');
 perform os_private.os_reopen_order(target,expected_version,justification);
 update public.os_orders set service_summary=null,final_observations=null where id=target;
end; $$;
create or replace function public.os_reopen_order(target uuid,justification text) returns void
 language plpgsql security definer set search_path='' as $$
begin perform os_private.require_permission('orders.reopen'); raise exception 'Informe versão e justificativa da reabertura' using errcode='22023'; end; $$;
create or replace function public.os_change_status(target uuid,next_status text,reason text default '') returns void
 language plpgsql security definer set search_path='' as $$
begin raise exception 'Utilize uma ação do workflow; alteração direta de estado indisponível' using errcode='42501'; end; $$;
create function public.os_complete_order(target uuid,expected_version bigint,solution text,service_summary text,final_notes text) returns void
 language plpgsql security definer set search_path='' as $$
declare o public.os_orders;
begin
 o:=os_private.lock_order(target,expected_version); perform os_private.require_service_action(o,'COMPLETE');
 if length(btrim(coalesce(service_summary,''))) not between 3 and 5000 or length(coalesce(final_notes,''))>5000 then raise exception 'Resumo ou observações inválidos' using errcode='22023'; end if;
 perform os_private.os_complete_order(target,expected_version,solution);
 update public.os_orders set service_summary=btrim($4),final_observations=btrim(coalesce(final_notes,'')) where id=target;
 perform os_private.record_order_event(target,o.status,'Concluída','service_completion_report',null,btrim(service_summary),os_private.order_actor_membership(o),
 jsonb_build_object('solution',solution,'final_notes',final_notes,'completed_at',statement_timestamp(),'version',expected_version+1));
end; $$;

create function public.os_add_message(target uuid,message_body text,submission_id uuid) returns uuid
 language plpgsql security definer set search_path='' as $$
declare o public.os_orders; message_id uuid;
begin
 perform os_private.require_permission('orders.view');
 select * into o from public.os_orders where id=target for update;
 if not found or not os_private.can_write_order(target) then raise exception 'Acesso negado' using errcode='42501'; end if;
 if submission_id is null or length(btrim(coalesce(message_body,''))) not between 1 and 5000 then raise exception 'Mensagem inválida' using errcode='22023'; end if;
 select id into message_id from public.os_messages where author_id=auth.uid() and request_id=submission_id;
 if found then
  if not exists(select 1 from public.os_messages where id=message_id and order_id=target and body=btrim(message_body)) then raise exception 'Identificador já utilizado' using errcode='22023'; end if;
  return message_id;
 end if;
 insert into public.os_messages(order_id,author_id,body,request_id) values(target,auth.uid(),btrim(message_body),submission_id) returning id into message_id;
 return message_id;
end; $$;
create function os_private.message_timeline() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.os_orders;
begin
 select * into o from public.os_orders where id=new.order_id;
 perform os_private.record_order_event(o.id,o.status,o.status,'message_added',null,new.body,
 os_private.order_actor_membership(o),jsonb_build_object('message_id',new.id,'author_id',new.author_id));
 return new;
end; $$;
create trigger message_functional_timeline after insert on public.os_messages for each row execute function os_private.message_timeline();

-- A reserva usa o UUID do envio como chave idempotente. Nenhum arquivo é sobrescrito.
create or replace function public.os_begin_attachment_upload(target_order uuid,attachment_id uuid,original_name text,declared_mime text,declared_size bigint,sha256 text)
 returns text language plpgsql security definer set search_path='' as $$
declare existing public.os_attachments;
begin
 perform os_private.require_permission('orders.view');
 perform 1 from public.os_orders where id=target_order and os_private.can_write_order(target_order) for update;
 if not found then raise exception 'Acesso negado' using errcode='42501'; end if;
 select * into existing from public.os_attachments where id=attachment_id;
 if found then
  if existing.order_id<>target_order or existing.uploaded_by<>auth.uid() or existing.name<>original_name
   or existing.mime_type<>declared_mime or existing.size_bytes<>declared_size or existing.content_sha256 is distinct from sha256 then
   raise exception 'Identificador de envio já utilizado' using errcode='22023'; end if;
  if existing.storage_status not in('pending','ready') then raise exception 'Envio indisponível; inicie um novo envio' using errcode='55000'; end if;
  return existing.path;
 end if;
 return os_private.os_begin_attachment_upload(target_order,attachment_id,original_name,declared_mime,declared_size,sha256);
end; $$;
create or replace function public.os_complete_attachment_upload(target uuid) returns text
 language plpgsql security definer set search_path='' as $$
declare a public.os_attachments; o public.os_orders;
begin
 perform os_private.require_permission('orders.view');
 select * into a from public.os_attachments where id=target and uploaded_by=auth.uid();
 if not found then raise exception 'Acesso negado' using errcode='42501'; end if;
 select * into o from public.os_orders where id=a.order_id for update;
 if not os_private.can_write_order(a.order_id) then raise exception 'Acesso negado' using errcode='42501'; end if;
 if a.storage_status='ready' then return 'ready'; end if;
 return os_private.os_complete_attachment_upload(target);
end; $$;

revoke all on function os_private.service_workflow_matrix(),os_private.has_open_service_issues(uuid),os_private.service_action_allowed(public.os_orders,text),os_private.require_service_action(public.os_orders,text),os_private.os_order_available_actions(uuid),os_private.management_order_available_actions(uuid),os_private.message_timeline() from public,anon,authenticated;
revoke all on function public.os_service_operation(uuid,bigint,text,text,text,bigint,text),public.os_complete_order(uuid,bigint,text,text,text),public.os_add_message(uuid,text,uuid) from public,anon;
grant execute on function public.os_service_operation(uuid,bigint,text,text,text,bigint,text),public.os_complete_order(uuid,bigint,text,text,text),public.os_add_message(uuid,text,uuid) to authenticated;
revoke all on function public.os_order_open_service_issues(uuid) from public,anon;
grant execute on function public.os_order_open_service_issues(uuid) to authenticated;
commit;
