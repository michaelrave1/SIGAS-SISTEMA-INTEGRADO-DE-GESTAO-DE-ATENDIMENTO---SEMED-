begin;

-- Exclusão lógica preserva o histórico imutável e os anexos para auditoria.
create or replace function os_private.can_read_order(o public.os_orders)
returns boolean language sql stable security definer set search_path = '' as $$
  select o.active and os_private.has_permission('orders.view') and (
    os_private.can_read_order_internal(o) or os_private.is_order_requester(o)
  );
$$;

create function public.os_delete_order(target uuid, expected_version bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare current_order public.os_orders%rowtype;
begin
  if auth.uid() is null or not os_private.is_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  current_order := os_private.lock_order(target, expected_version);
  update public.os_orders set active = false, version = version + 1 where id = target;
  insert into public.os_audit(actor,entity,record_id,action,before_data,after_data)
  values(auth.uid(),'os_orders',target::text,'DELETE',to_jsonb(current_order),
    jsonb_build_object('active',false,'logical_deletion',true));
end;
$$;
revoke all on function public.os_delete_order(uuid,bigint) from public,anon;
grant execute on function public.os_delete_order(uuid,bigint) to authenticated;
commit;
