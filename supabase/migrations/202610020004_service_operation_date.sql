-- Data do atendimento em todas as ações do formulário unificado.
-- A data de registro/auditoria continua sendo gerada pelo servidor.
begin;

create function public.os_service_operation(
  target uuid,
  expected_version bigint,
  service_action text,
  description text,
  entry_kind text,
  related_entry bigint,
  material_status text,
  serviced_on timestamptz
) returns bigint language plpgsql security definer set search_path='' as $$
declare created_entry bigint;
begin
  if serviced_on is null or not isfinite(serviced_on) then
    raise exception 'Data do atendimento inválida' using errcode='22023';
  end if;
  -- A implementação existente valida sessão, RBAC, escopo, ciência, estado e
  -- versão; criação do atendimento, transição e eventos são transacionais.
  created_entry := public.os_service_operation(
    target,expected_version,service_action,description,entry_kind,related_entry,material_status
  );
  -- Somente o registro recém-criado, ainda nesta transação, recebe a data
  -- informada. Nenhum atendimento anterior é atualizado.
  update public.os_order_service_entries set serviced_at=serviced_on
  where id=created_entry and order_id=target;
  return created_entry;
end;
$$;

revoke all on function public.os_service_operation(uuid,bigint,text,text,text,bigint,text,timestamptz) from public,anon;
grant execute on function public.os_service_operation(uuid,bigint,text,text,text,bigint,text,timestamptz) to authenticated;
commit;
