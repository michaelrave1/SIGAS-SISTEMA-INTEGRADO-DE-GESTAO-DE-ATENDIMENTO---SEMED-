-- Permite converter Gestor da Unidade em Gestor de Área sem exigir que o
-- administrador limpe manualmente a unidade antiga do vínculo.
begin;

create or replace function public.os_save_professional_membership(
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
    where c.kind='logistics' and c.active
      and btrim(c.data->>'area')=normalized_area
  ) then raise exception 'Área inválida'; end if;

  saved_membership := os_private.os_save_professional_membership(
    target_membership,target_professional,professional_email,professional_name,
    professional_registration,professional_position,
    case when target_role='gestor_area' then null else target_unit end,
    case when target_role='gestor_area' then 'gestor' else target_role end,
    professional_active,membership_active
  );

  update public.os_memberships set
    area=normalized_area,
    access_profile_id=(
      select p.id from public.os_access_profiles p where p.key=case
        when target_role='gestor_area' then 'area_manager'
        when target_role='gestor' then 'manager'
        when target_role='admin' then 'admin'
        when target_role='solicitante' then 'requester'
        else 'responsible'
      end
    )
  where id=saved_membership;

  return saved_membership;
end;
$$;

revoke all on function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,text,boolean,boolean
) from public,anon;
grant execute on function public.os_save_professional_membership(
  uuid,uuid,text,text,text,text,uuid,text,text,boolean,boolean
) to authenticated;

commit;
