-- Ciência por mensagem e destinatário, integrada ao bloqueio de ciência existente.
-- Sem backfill: mensagens históricas e seus destinatários não são reinterpretados.
begin;
create table public.os_message_acknowledgements (
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null references public.os_messages(id) on delete cascade,
 recipient_id uuid not null references auth.users(id),
 delivered_at timestamptz not null,
 acknowledged_at timestamptz,
 acknowledged_by uuid references auth.users(id),
 unique(message_id,recipient_id),
 check((acknowledged_at is null and acknowledged_by is null) or
 (acknowledged_at is not null and acknowledged_by is not null and acknowledged_by=recipient_id and acknowledged_at>=delivered_at))
);
create index message_acknowledgements_pending on public.os_message_acknowledgements(recipient_id,delivered_at,id) where acknowledged_at is null;
create function os_private.capture_message_recipients() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 insert into public.os_message_acknowledgements(message_id,recipient_id,delivered_at)
 select distinct new.id,m.user_id,new.created_at
 from public.os_orders o
 join public.os_memberships m on m.active and m.user_id is not null
 join public.os_professionals person on person.id=m.professional_id and person.active and person.auth_user_id=m.user_id
 join public.os_access_profiles profile on profile.id=m.access_profile_id and profile.active
 join public.os_access_profile_permissions ap on ap.access_profile_id=profile.id
 join public.os_permissions permission on permission.id=ap.permission_id and permission.key='orders.view'
 left join public.os_catalogs category on category.id=o.category_id
 where o.id=new.order_id and o.active and m.user_id is distinct from new.author_id and (
   (m.user_id=o.opened_by and ((m.role='solicitante' and m.unit_id=o.unit_id) or m.role='admin')) or
   (m.id=o.responsible_membership_id and m.user_id=o.responsible_id and m.role='responsavel' and
     (m.area=btrim(category.data->>'area') or (m.area is null and m.unit_id=coalesce(o.destination_unit_id,o.unit_id)))) or
   (m.role='gestor' and profile.key='area_manager' and m.area=btrim(category.data->>'area')) or
   (m.role='gestor' and profile.key='manager' and m.unit_id=o.unit_id)
 ) on conflict(message_id,recipient_id) do nothing;
 return new;
end; $$;
create trigger message_recipient_capture after insert on public.os_messages
 for each row execute function os_private.capture_message_recipients();
alter table public.os_message_acknowledgements enable row level security;
create policy message_acknowledgements_recipient_read on public.os_message_acknowledgements
 for select to authenticated using(recipient_id=(select auth.uid()) and os_private.has_permission('orders.view')
 and exists(select 1 from public.os_messages message join public.os_orders o on o.id=message.order_id
 where message.id=message_id and o.active and os_private.can_read_order(o)));
create trigger message_acknowledgements_audit after insert or update or delete on public.os_message_acknowledgements
 for each row execute function os_private.audit_change();
revoke all on public.os_message_acknowledgements from public,anon,authenticated;
grant select on public.os_message_acknowledgements to authenticated;
grant all on public.os_message_acknowledgements to service_role;

create function public.os_pending_all_acknowledgements() returns jsonb
 language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by item->>'encaminhado_em',item->>'id'),'[]'::jsonb)
 from (
   select value||jsonb_build_object('kind','dispatch') item
   from jsonb_array_elements(public.os_pending_acknowledgements())
   union all
   select jsonb_build_object('kind','message','id',receipt.id,'os_id',o.id,
     'protocol',coalesce(o.protocol_code,o.protocol::text),'title',o.title,
     'encaminhado_em',receipt.delivered_at,'body',message.body,'author_name',coalesce(author.name,'Equipe da OS'))
   from public.os_message_acknowledgements receipt
   join public.os_messages message on message.id=receipt.message_id
   join public.os_orders o on o.id=message.order_id
   left join public.os_profiles author on author.id=message.author_id
   where receipt.recipient_id=(select auth.uid()) and receipt.acknowledged_at is null
   and o.active and os_private.has_permission('orders.view') and os_private.can_read_order(o)
 ) pending;
$$;
create function public.os_acknowledge_message(target uuid) returns timestamptz
 language plpgsql security definer set search_path='' as $$
declare receipt public.os_message_acknowledgements; current_order public.os_orders; ack_time timestamptz; recipient_name text;
begin
 perform os_private.require_permission('orders.view');
 select r.* into receipt from public.os_message_acknowledgements r where r.id=target and r.recipient_id=auth.uid();
 if not found then raise exception 'Acesso negado' using errcode='42501'; end if;
 -- Ordem de locks: OS, depois recibo, como no fluxo de encaminhamento.
 select o.* into current_order from public.os_orders o join public.os_messages message on message.order_id=o.id
 where message.id=receipt.message_id for update of o;
 if not found or not current_order.active or not os_private.can_read_order(current_order) then
  raise exception 'Acesso negado' using errcode='42501';
 end if;
 select r.* into receipt from public.os_message_acknowledgements r where r.id=target for update;
 if receipt.acknowledged_at is not null then return receipt.acknowledged_at; end if;
 ack_time:=clock_timestamp();
 update public.os_message_acknowledgements set acknowledged_at=ack_time,acknowledged_by=auth.uid() where id=target;
 select name into recipient_name from public.os_profiles where id=auth.uid();
 perform os_private.record_order_event(current_order.id,current_order.status,current_order.status,
  'message_acknowledged',null,'Ciência da mensagem por '||coalesce(recipient_name,'destinatário'),
  os_private.order_actor_membership(current_order),jsonb_build_object('message_id',receipt.message_id,
    'receipt_id',receipt.id,'recipient_id',receipt.recipient_id,'acknowledged_at',ack_time,'acknowledged_by',auth.uid()));
 return ack_time;
end; $$;
-- O solicitante pode consultar o evento de ciência sem obter eventos internos da OS.
alter function os_private.can_read_order_event(uuid,text) rename to can_read_order_event_before_message_science;
create function os_private.can_read_order_event(target uuid,event_kind text) returns boolean
 language sql stable security definer set search_path='' as $$
 select os_private.can_read_order_event_before_message_science(target,event_kind) or
 (event_kind='message_acknowledged' and exists(select 1 from public.os_orders o where o.id=target and os_private.can_read_order(o)));
$$;
-- Recria a policy para vincular a função atual, preservando a autorização original.
drop policy order_events_read on public.os_order_events;
create policy order_events_read on public.os_order_events for select to authenticated using(os_private.can_read_order_event(order_id,event_type));
revoke all on function os_private.capture_message_recipients(),os_private.can_read_order_event_before_message_science(uuid,text) from public,anon,authenticated;
revoke all on function os_private.can_read_order_event(uuid,text) from public,anon;
grant execute on function os_private.can_read_order_event(uuid,text) to authenticated;
revoke all on function public.os_pending_all_acknowledgements(),public.os_acknowledge_message(uuid) from public,anon;
grant execute on function public.os_pending_all_acknowledgements(),public.os_acknowledge_message(uuid) to authenticated;
commit;
