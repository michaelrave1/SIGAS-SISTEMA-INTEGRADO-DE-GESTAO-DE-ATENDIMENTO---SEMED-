-- Ciência individual por encaminhamento. Não altera status, versões ou eventos antigos.
begin;

create table public.os_order_dispatches (
 id uuid primary key default gen_random_uuid(),
 os_id uuid not null references public.os_orders(id) on delete cascade,
 usuario_destino_id uuid not null references auth.users(id),
 encaminhado_em timestamptz not null,
 ciente_em timestamptz,
 ciente_por uuid references auth.users(id),
 evento_id bigint unique references public.os_order_events(id) on delete cascade,
 origem text not null default 'encaminhamento' check(origem in ('encaminhamento','implantacao')),
 constraint dispatch_acknowledgement_consistent check (
   (ciente_em is null and ciente_por is null) or
   (ciente_em is not null and ciente_por is not null and ciente_por=usuario_destino_id and ciente_em>=encaminhado_em)
 )
);
create index order_dispatches_pending on public.os_order_dispatches(usuario_destino_id,encaminhado_em,id) where ciente_em is null;
create index order_dispatches_order on public.os_order_dispatches(os_id);
create index order_dispatches_ack_actor on public.os_order_dispatches(ciente_por) where ciente_por is not null;

create function os_private.capture_order_dispatch() returns trigger
 language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 -- O aceite da atribuição também gera order_assigned, mas não contém novo destinatário.
 if new.event_type not in ('order_forwarded','order_reassigned','order_assigned')
   or not (coalesce(new.metadata,'{}'::jsonb) ? 'responsible_membership_id') then return new; end if;
 select m.user_id into recipient from public.os_memberships m
 where m.id::text=new.metadata->>'responsible_membership_id';
 if recipient is null then raise exception 'Destinatário do encaminhamento indisponível'; end if;
 insert into public.os_order_dispatches(os_id,usuario_destino_id,encaminhado_em,evento_id)
 values(new.order_id,recipient,new.created_at,new.id);
 return new;
end; $$;
create trigger order_dispatch_capture after insert on public.os_order_events
 for each row execute function os_private.capture_order_dispatch();

-- Apenas o destinatário atual de OS ainda encaminhadas recebe uma pendência inicial.
-- A origem distingue a implantação de um novo encaminhamento; não se inventa ciência
-- nem se atribuem eventos antigos a usuários que já não são seus destinatários atuais.
insert into public.os_order_dispatches(os_id,usuario_destino_id,encaminhado_em,evento_id,origem)
 select o.id,o.responsible_id,coalesce(e.created_at,o.forwarded_at,o.assigned_at,statement_timestamp()),e.id,'implantacao'
 from public.os_orders o
 left join lateral (
   select ev.id,ev.created_at from public.os_order_events ev
   where ev.order_id=o.id and ev.event_type in('order_forwarded','order_reassigned','order_assigned')
     and ev.metadata->>'responsible_membership_id'=o.responsible_membership_id::text
   order by ev.created_at desc,ev.id desc limit 1
 ) e on true
 where o.active and o.status='Encaminhada' and o.responsible_id is not null;

alter table public.os_order_dispatches enable row level security;
create policy dispatches_recipient_read on public.os_order_dispatches for select to authenticated
 using(usuario_destino_id=(select auth.uid()) and os_private.has_permission('orders.view') and exists(
   select 1 from public.os_orders o where o.id=os_id and os_private.can_read_order(o)
 ));

create function public.os_pending_acknowledgements() returns jsonb
 language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',d.id,'os_id',d.os_id,'protocol',coalesce(o.protocol_code,o.protocol::text),
   'title',o.title,'encaminhado_em',d.encaminhado_em
 ) order by d.encaminhado_em,d.id),'[]'::jsonb)
 from public.os_order_dispatches d join public.os_orders o on o.id=d.os_id
 where d.usuario_destino_id=(select auth.uid()) and d.ciente_em is null
   and o.active and o.status not in('Concluída','Cancelada')
   and os_private.has_permission('orders.view') and os_private.can_read_order(o);
$$;

create function public.os_acknowledge_dispatch(target uuid) returns timestamptz
 language plpgsql security definer set search_path='' as $$
declare
 dispatch public.os_order_dispatches%rowtype;
 current_order public.os_orders%rowtype;
 acknowledged_at timestamptz;
 recipient_name text;
begin
 perform os_private.require_permission('orders.view');
 select d.* into dispatch from public.os_order_dispatches d
 where d.id=target and d.usuario_destino_id=auth.uid();
 if not found then raise exception 'Acesso negado' using errcode='42501'; end if;
 -- Mesma ordem de locks do encaminhamento: OS, depois registro de ciência.
 select o.* into current_order from public.os_orders o where o.id=dispatch.os_id for update;
 if not found or not os_private.can_read_order(current_order) then
   raise exception 'Acesso negado' using errcode='42501';
 end if;
 select d.* into dispatch from public.os_order_dispatches d where d.id=target for update;
 if dispatch.ciente_em is not null then return dispatch.ciente_em; end if;
 if not current_order.active or current_order.status in('Concluída','Cancelada') then
   raise exception 'A OS não está mais aberta' using errcode='55000';
 end if;
 acknowledged_at:=clock_timestamp();
 update public.os_order_dispatches set ciente_em=acknowledged_at,ciente_por=auth.uid() where id=target;
 select name into recipient_name from public.os_profiles where id=auth.uid();
 perform os_private.record_order_event(
   dispatch.os_id,current_order.status,current_order.status,'order_acknowledged',null,
   'Ciência do encaminhamento por '||coalesce(recipient_name,'destinatário'),
   os_private.order_actor_membership(current_order),
   jsonb_build_object('dispatch_id',dispatch.id,'usuario_destino_id',dispatch.usuario_destino_id,
     'encaminhado_em',dispatch.encaminhado_em,'ciente_em',acknowledged_at,'ciente_por',auth.uid())
 );
 return acknowledged_at;
end; $$;

create trigger dispatches_audit after insert or update or delete on public.os_order_dispatches
 for each row execute function os_private.audit_change();
revoke all on public.os_order_dispatches from public,anon,authenticated;
grant select on public.os_order_dispatches to authenticated;
grant all on public.os_order_dispatches to service_role;
revoke all on function os_private.capture_order_dispatch() from public,anon,authenticated;
revoke all on function public.os_pending_acknowledgements(),public.os_acknowledge_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.os_pending_acknowledgements(),public.os_acknowledge_dispatch(uuid) to authenticated;

-- Mantém a projeção autorizada e inclui o destinatário do encaminhamento profissional.
create or replace function public.os_order_timeline(
  target uuid,
  page_size integer default 25,
  page_offset integer default 0
) returns table(
  event_id bigint,
  event_type text,
  created_at timestamptz,
  actor_name text,
  actor_role text,
  actor_unit_name text,
  summary text,
  from_status text,
  to_status text,
  total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  current_order public.os_orders%rowtype;
  internal_access boolean;
begin
  if auth.uid() is null then raise exception 'Acesso negado'; end if;
  if page_size not between 1 and 100 or page_offset not between 0 and 2500000 then
    raise exception 'Paginação inválida';
  end if;

  select o.* into current_order
  from public.os_orders o
  where o.id=target and os_private.can_read_order(o);
  if not found then return; end if;
  internal_access := os_private.can_read_order_internal(current_order);

  return query
  select
    e.id,
    case
      when e.event_type='order_edited' and
           e.metadata->>'priority_changed'='true' then 'priority_changed'
      else e.event_type
    end,
    e.created_at,
    case
      when e.actor is null then 'Importação / sistema'
      when e.actor=(select auth.uid()) then 'Você'
      when internal_access then coalesce(actor_profile.name,'Usuário não identificado')
      else 'Equipe da OS'
    end,
    case when internal_access or e.actor=(select auth.uid()) then
      case actor_membership.role
        when 'admin' then 'Administrador'
        when 'gestor' then 'Gestor'
        when 'solicitante' then 'Solicitante'
        when 'responsavel' then 'Responsável'
        else null
      end
    end,
    case when internal_access or e.actor=(select auth.uid())
      then actor_unit.name else null end,
    case
      when e.event_type='order_forwarded' then
        case when assigned_profile.name is not null then 'Destinatário: ' || assigned_profile.name
          when destination_unit.name is not null then 'Unidade executora: ' || destination_unit.name end
      when e.event_type='order_assigned' then
        case when assigned_profile.name is not null
          then 'Responsável: ' || assigned_profile.name end
      when e.event_type='order_reassigned' then
        concat_ws(' · ',
          case when assigned_profile.name is not null
            then 'Novo responsável: ' || assigned_profile.name end,
          nullif(e.reason,'')
        )
      when e.event_type='service_entry_added' then
        case when service_entry.entry_type is not null
          then 'Tipo: ' || service_entry.entry_type end
      when e.event_type in ('attachment_added','service_attachment_added') then
        case when coalesce(attachment.name,e.metadata->>'attachment_name') is not null
          then 'Arquivo: ' || coalesce(attachment.name,e.metadata->>'attachment_name') end
      when e.event_type='service_resumed' then
        case when e.to_status is not null then 'Retorno para ' || e.to_status end
      else nullif(e.reason,'')
    end,
    e.from_status,
    e.to_status,
    count(*) over()
  from public.os_order_events e
  left join public.os_memberships actor_membership
    on actor_membership.id=e.actor_membership_id
  left join public.os_profiles actor_profile on actor_profile.id=e.actor
  left join public.os_units actor_unit on actor_unit.id=actor_membership.unit_id
  left join public.os_units destination_unit
    on destination_unit.id::text=e.metadata->>'destination_unit_id'
  left join public.os_memberships assigned_membership
    on assigned_membership.id::text=e.metadata->>'responsible_membership_id'
  left join public.os_profiles assigned_profile
    on assigned_profile.id=assigned_membership.user_id
  left join public.os_order_service_entries service_entry
    on service_entry.id::text=e.metadata->>'service_entry_id'
  left join public.os_attachments attachment
    on attachment.id::text=e.metadata->>'attachment_id'
  where e.order_id=target
    and os_private.can_read_order_event(e.order_id,e.event_type)
  order by e.created_at,e.id
  limit page_size offset page_offset;
end;
$$;


commit;
