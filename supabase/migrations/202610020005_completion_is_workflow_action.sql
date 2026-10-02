-- Encerramento é uma transição do workflow, nunca um tipo de registro comum.
-- Desativa os tipos correspondentes, sem excluir cadastros ou atendimentos.
begin;
create function os_private.is_completion_service_type(type_key text,type_name text)
 returns boolean language sql immutable set search_path='' as $$
 select exists(select 1 from unnest(array[type_key,type_name]) value
 where regexp_replace(btrim(translate(lower(value),'ãáàâéêíóôõúüç','aaaaeeiooouuc')),'[[:space:]_-]+',' ','g')
 in('encerrar atendimento','encerrar o atendimento','encerramento do atendimento','encerramento de atendimento','encerramento atendimento'));
$$;

update public.os_service_entry_types set active=false
 where active and os_private.is_completion_service_type(key,name);

create function os_private.guard_completion_service_type() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' or new.active) and os_private.is_completion_service_type(new.key,new.name) then
  raise exception 'Encerramento deve ser realizado pela ação de conclusão da OS' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger service_type_completion_guard before insert or update on public.os_service_entry_types
 for each row execute function os_private.guard_completion_service_type();

create function os_private.guard_completion_service_entry() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.os_service_entry_types t where t.key=new.entry_type
 and os_private.is_completion_service_type(t.key,t.name)) then
  raise exception 'Utilize a ação de conclusão da OS' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger service_entry_completion_guard before insert or update of entry_type on public.os_order_service_entries
 for each row execute function os_private.guard_completion_service_entry();

revoke all on function os_private.is_completion_service_type(text,text),os_private.guard_completion_service_type(),os_private.guard_completion_service_entry() from public,anon,authenticated;
commit;
