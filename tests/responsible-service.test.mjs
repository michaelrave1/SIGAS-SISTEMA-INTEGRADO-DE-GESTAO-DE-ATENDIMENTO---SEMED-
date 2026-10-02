import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const directory = new URL("../supabase/migrations/", import.meta.url);
const files = (await fs.readdir(directory)).filter(name => name.endsWith(".sql") && !name.endsWith("_performance_indexes.sql")).sort();
const migration = "202610020003_responsible_service_workflow.sql";

for (const upgrade of [false, true]) test(`atendimento completo: ${upgrade ? "upgrade preservando histórico" : "instalação limpa"}`, async () => {
  const db = new PGlite();
  const id = n => `92000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
  const admin=id(1), requester=id(2), tech=id(3), other=id(4), outsider=id(5), unit=id(6), category=id(7), order=id(8);
  const as = async (user, sql, args=[]) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
    try { return await db.query(sql,args); }
    finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
  };
  const state = async () => (await db.query("select * from os_orders where id=$1",[order])).rows[0];
  const version = async () => (await state()).version;
  const operation = async (action,description="Registro técnico detalhado",related=null,material=null,user=tech) =>
    as(user,"select os_service_operation($1,$2,$3,$4,'observação técnica',$5,$6) id",[order,await version(),action,description,related,material]);
  const acknowledge = async user => as(user,"select os_acknowledge_dispatch(id) from os_order_dispatches where os_id=$1 and ciente_em is null",[order]);
  const actions = async user => (await as(user,"select operation from os_order_available_actions($1)",[order])).rows.map(row=>row.operation);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb not null default '{}',created_at timestamptz not null default now());
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;`);
    for(const file of files.filter(file=>file<migration)) await db.exec(await fs.readFile(new URL(file,directory),"utf8"));
    if(!upgrade) await db.exec(await fs.readFile(new URL(migration,directory),"utf8"));
    await db.exec(`insert into auth.users values('${admin}'),('${requester}'),('${tech}'),('${other}'),('${outsider}');
      insert into os_profiles select id,'Pessoa teste' from auth.users;
      insert into os_units(id,name) values('${unit}','UNIDADE');
      insert into os_catalogs(id,legacy_id,kind,name,data) values('${category}','SERVICE-CAT','logistics','DETIC','{"area":"DETIC"}');
      insert into os_memberships(user_id,unit_id,role,area) values
      ('${admin}',null,'admin',null),('${requester}','${unit}','solicitante',null),
      ('${tech}','${unit}','responsavel','DETIC'),('${other}','${unit}','responsavel','DETIC'),('${outsider}','${unit}','responsavel','OUTRA ÁREA');
      insert into os_orders(id,title,unit_id,opened_by,category_id,status) values('${order}','Teste atendimento','${unit}','${requester}','${category}','Aberta');
      insert into os_messages(order_id,author_id,body) values('${order}','${requester}','Mensagem anterior');`);
    if(upgrade) {
      await db.exec(await fs.readFile(new URL(migration,directory),"utf8"));
      assert.equal((await db.query("select count(*)::int n from os_messages where order_id=$1",[order])).rows[0].n,1);
    }
    const membership=(await db.query("select id from os_memberships where user_id=$1",[tech])).rows[0].id;
    const otherMembership=(await db.query("select id from os_memberships where user_id=$1",[other])).rows[0].id;
    await as(admin,"select os_start_triage($1,1)",[order]);
    await as(admin,"select os_assign_order($1,2,$2)",[order,membership]);
    assert.equal((await state()).status,"Encaminhada");
    await assert.rejects(as(tech,"select os_accept_assignment($1,3)",[order]),/Ação não permitida/);
    const dispatch=(await as(tech,"select id from os_order_dispatches where os_id=$1",[order])).rows[0].id;
    await assert.rejects(as(other,"select os_acknowledge_dispatch($1)",[dispatch]),/Acesso negado/);
    await acknowledge(tech);
    await db.query("update os_memberships set area='OUTRA ÁREA' where id=$1",[membership]);
    await assert.rejects(as(tech,"select os_accept_assignment($1,3)",[order]),/Ação não permitida/);
    await db.query("update os_memberships set area='DETIC' where id=$1",[membership]);
    const time=(await as(tech,"select os_acknowledge_dispatch($1) t",[dispatch])).rows[0].t;
    assert.deepEqual((await as(tech,"select os_acknowledge_dispatch($1) t",[dispatch])).rows[0].t,time);
    assert.ok((await actions(tech)).includes("ACCEPT_ASSIGNMENT"));
    await as(tech,"select os_accept_assignment($1,3)",[order]);
    await assert.rejects(as("","select os_start_service($1,4)",[order]),/Acesso negado/);
    await db.exec("delete from os_access_profile_permissions where access_profile_id=(select id from os_access_profiles where key='responsible') and permission_id=(select id from os_permissions where key='orders.attend')");
    await assert.rejects(as(tech,"select os_start_service($1,4)",[order]),/Ação não permitida/);
    await db.exec("insert into os_access_profile_permissions select p.id,q.id,now() from os_access_profiles p cross join os_permissions q where p.key='responsible' and q.key='orders.attend'");
    await assert.rejects(as(other,"select os_start_service($1,4)",[order]),/Ação não permitida/);
    await assert.rejects(as(outsider,"select os_start_service($1,4)",[order]),/Ação não permitida/);
    await as(tech,"select os_start_service($1,4)",[order]);
    await assert.rejects(as(tech,"select os_start_service($1,4)",[order]),/alterada/);
    for(const kind of ["diagnóstico","ação realizada","visita","material","observação técnica"])
      await as(tech,"select os_add_service_entry($1,$2,$3,'Serviço técnico registrado',now())",[order,await version(),kind]);
    const beforeInvalid=await version();
    await assert.rejects(as(tech,"select os_service_operation($1,$2,'PENDING','Falha deve ser atômica','TIPO INEXISTENTE')",[order,beforeInvalid]),/Tipo de atendimento/);
    assert.equal(await version(),beforeInvalid);
    const issue=(await operation("PENDING")).rows[0].id;
    const impediment=(await operation("IMPEDIMENT")).rows[0].id;
    assert.equal((await as(tech,"select * from os_order_open_service_issues($1)",[order])).rows.length,2);
    assert.equal((await as(outsider,"select * from os_order_open_service_issues($1)",[order])).rows.length,0);
    assert.ok(!(await actions(tech)).includes("COMPLETE"));
    await assert.rejects(as(tech,"select os_complete_order($1,$2,'Solução','Resumo','')",[order,await version()]),/Ação não permitida/);
    await operation("RESOLVE","Pendência resolvida",issue);
    await assert.rejects(operation("RESOLVE","Repetição",issue),/já resolvida/);
    await operation("RESOLVE","Impedimento resolvido",impediment);
    const stale=await version();
    await operation("OPERATIONAL_UPDATE","Material aplicado e configuração revisada",null,"Sim");
    assert.equal((await state()).details.has_material,"Sim");
    await assert.rejects(as(tech,"select os_service_operation($1,$2,'PENDING','Repetição','observação técnica')",[order,stale]),/alterada/);
    const request=id(9);
    await as(tech,"select os_add_message($1,'Mensagem técnica',$2)",[order,request]);
    await assert.rejects(as(tech,"select os_add_message($1,'Mensagem diferente',$2)",[order,request]),/já utilizado/);
    await as(tech,"select os_add_message($1,'Mensagem técnica',$2)",[order,request]);
    assert.equal((await db.query("select count(*)::int n from os_messages where request_id=$1",[request])).rows[0].n,1);
    await assert.rejects(as(other,"select os_service_operation($1,$2,'PENDING','Não autorizado','observação técnica')",[order,await version()]),/Ação não permitida/);
    const attachment=id(10),hash="a".repeat(64);
    const reserve=()=>as(tech,"select os_begin_attachment_upload($1,$2,'teste.pdf','application/pdf',10,$3) path",[order,attachment,hash]);
    const path=(await reserve()).rows[0].path;
    assert.equal((await reserve()).rows[0].path,path);
    await assert.rejects(as(tech,"select os_begin_attachment_upload($1,$2,'teste.pdf','application/pdf',10,$3)",[order,attachment,"b".repeat(64)]),/já utilizado/);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('os-attachments',$1,'{\"size\":10,\"mimetype\":\"application/pdf\"}')",[path]);
    await as(tech,"select os_complete_attachment_upload($1)",[attachment]);
    await as(tech,"select os_complete_attachment_upload($1)",[attachment]);
    await operation("REQUEST_INFORMATION","Qual o número patrimonial do equipamento?");
    assert.equal((await state()).status,"Aguardando informação");
    assert.equal((await state()).waiting_reason,"solicitante");
    const requested=(await db.query("select metadata from os_order_events where order_id=$1 and event_type='information_requested'",[order])).rows[0];
    assert.equal(requested.metadata.recipient_id,requester);
    await as(requester,"select os_add_message($1,'Patrimônio informado',$2)",[order,id(11)]);
    await assert.rejects(as(tech,"select os_add_service_entry($1,$2,'visita','Visita em espera',now())",[order,await version()]),/Ação não permitida/);
    await as(tech,"select os_resume_service($1,$2)",[order,await version()]);
    await assert.rejects(as(tech,"select os_wait_for_information($1,$2,'material','')",[order,await version()]),/inválido/);
    await as(tech,"select os_wait_for_information($1,$2,'material','Aguardando peça de reposição')",[order,await version()]);
    await as(tech,"select os_resume_service($1,$2)",[order,await version()]);
    const period=(await db.query("select metadata from os_order_events where order_id=$1 and event_type='wait_period_closed' order by id desc limit 1",[order])).rows[0].metadata;
    assert.ok(period.waiting_since && period.resumed_at);
    await operation("REQUEST_FORWARDING","Atendimento requer outro profissional da área");
    await assert.rejects(as(tech,"select os_reassign_order($1,$2,$3,'Transferência indevida')",[order,await version(),otherMembership]),/Acesso negado/);
    const priorVersion=await version();
    await operation("RETURN_TRIAGE","Reavaliar a classificação e o destino");
    assert.equal((await state()).status,"Em triagem");
    assert.equal((await state()).responsible_id,null);
    const returned=(await db.query("select metadata from os_order_events where order_id=$1 and event_type='order_returned_triage'",[order])).rows[0].metadata;
    assert.equal(returned.previous_responsible_id,tech);
    await assert.rejects(as(tech,"select os_service_operation($1,$2,'RETURN_TRIAGE','Repetição','observação técnica')",[order,priorVersion]),/alterada/);
    await as(admin,"select os_assign_order($1,$2,$3)",[order,await version(),otherMembership]);
    await acknowledge(other);
    await as(other,"select os_accept_assignment($1,$2)",[order,await version()]);
    await as(admin,"select os_reassign_order($1,$2,$3,'Retorno ao profissional original')",[order,await version(),membership]);
    assert.equal((await as(tech,"select count(*)::int n from os_order_dispatches where os_id=$1 and ciente_em is null",[order])).rows[0].n,1);
    await acknowledge(tech);
    await as(tech,"select os_accept_assignment($1,$2)",[order,await version()]);
    await as(tech,"select os_start_service($1,$2)",[order,await version()]);
    await assert.rejects(as(tech,"select os_complete_order($1,$2,'Solução','','')",[order,await version()]),/inválidos/);
    await assert.rejects(as(tech,"select os_change_status($1,'Concluída','Atalho')",[order]),/workflow/);
    await assert.rejects(as(tech,"select os_complete_order($1,$2,'Atalho')",[order,await version()]),/resumo/);
    const lastVersion=await version();
    await as(tech,"select os_complete_order($1,$2,'Equipamento normalizado','Diagnóstico, visita e reparo executados','Sem restrições')",[order,lastVersion]);
    const closed=await state();
    assert.equal(closed.status,"Concluída"); assert.ok(closed.completed_at);
    assert.equal(closed.final_observations,"Sem restrições");
    await assert.rejects(as(tech,"select os_complete_order($1,$2,'Solução','Resumo','')",[order,lastVersion]),/alterada/);
    await assert.rejects(operation("PENDING"),/Ação não permitida/);
    await assert.rejects(as(tech,"select os_add_message($1,'Após encerramento',$2)",[order,id(12)]),/Acesso negado/);
    await assert.rejects(as(tech,"select os_begin_attachment_upload($1,$2,'novo.pdf','application/pdf',10,$3)",[order,id(13),hash]),/Acesso negado/);
    const events=(await as(tech,"select event_type from os_order_timeline($1,100,0)",[order])).rows.map(row=>row.event_type);
    for(const event of ["order_acknowledged","service_started","service_entry_added","message_added","service_impediment","service_pending","service_issue_resolved","information_requested","forwarding_requested","order_returned_triage","order_completed","service_completion_report"])
      assert.ok(events.includes(event),event);
    for(const entity of ["os_orders","os_messages","os_order_service_entries","os_attachments","os_order_dispatches"])
      assert.ok((await db.query("select count(*)::int n from os_audit where entity=$1",[entity])).rows[0].n>0,entity);
    await as(tech,"select os_reopen_order($1,$2,'Nova ocorrência confirmada')",[order,await version()]);
    assert.equal((await state()).status,"Em triagem");
    assert.ok((await db.query("select count(*)::int n from os_order_service_entries where order_id=$1",[order])).rows[0].n>=10);
    assert.equal((await as(outsider,"select id from os_orders where id=$1",[order])).rows.length,0);
  } finally { await db.close(); }
});
