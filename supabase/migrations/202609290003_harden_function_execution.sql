-- Fecha funções administrativas internas e impede que novas funções recebam
-- EXECUTE público implicitamente. As RPCs os_* necessárias ao aplicativo
-- continuam concedidas explicitamente ao papel authenticated e repetem RBAC,
-- escopo e validação de estado dentro do banco.
begin;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable()
      from public,anon,authenticated;
  end if;
end;
$$;

alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema public
  revoke execute on functions from anon;

commit;
