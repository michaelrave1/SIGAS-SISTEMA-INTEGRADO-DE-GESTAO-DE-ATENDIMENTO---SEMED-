import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("responsável atual: gestor da área, encaminhamento, reatribuição, devolução e isolamento", async () => {
  const db = new PGlite();
  const id = n => `93000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
  const admin=id(1), requester=id(2), manager=id(3), tech=id(4), nextTech=id(5), outsider=id(6), unitManager=id(7), secondManager=id(8),
    unit=id(9), category=id(10), order=id(11), otherCategory=id(12), otherOrder=id(13);
  const as = async (user, sql, args=[]) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
    try { return await db.query(sql,args); }
    finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
  };
  const current = async (user=requester, targets=[order]) =>
    (await as(user,"select * from os_order_current_responsibles($1)",[targets])).rows;
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
    const directory = new URL("../supabase/migrations/",import.meta.url);
    for(const file of (await fs.readdir(directory)).filter(name=>name.endsWith(".sql")&&!name.endsWith("_performance_indexes.sql")).sort())
      await db.exec(await fs.readFile(new URL(file,directory),"utf8"));
    await db.exec(`insert into auth.users values('${admin}'),('${requester}'),('${manager}'),('${tech}'),('${nextTech}'),('${outsider}'),('${unitManager}'),('${secondManager}');
      insert into os_profiles(id,name) values('${admin}','Admin'),('${requester}','Solicitante'),('${manager}','Gestor DETIC'),('${tech}','Profissional atual'),('${nextTech}','Próximo profissional'),('${outsider}','Gestor outra área'),('${unitManager}','Gestor da unidade'),('${secondManager}','Segundo gestor DETIC');
      insert into os_units(id,name) values('${unit}','UNIDADE');
      insert into os_catalogs(id,legacy_id,kind,name,data) values('${category}','CURRENT-DETIC','logistics','DETIC','{"area":"DETIC"}'),('${otherCategory}','CURRENT-OTHER','logistics','OUTRA ÁREA','{"area":"OUTRA ÁREA"}');
      insert into os_memberships(user_id,unit_id,role,area) values('${admin}',null,'admin',null),('${requester}','${unit}','solicitante',null),('${tech}','${unit}','responsavel','DETIC'),('${nextTech}','${unit}','responsavel','DETIC'),('${unitManager}','${unit}','gestor',null);
      insert into os_memberships(user_id,unit_id,role,area,access_profile_id)
      select u.user_id,null,'gestor',u.area,p.id from (values('${manager}'::uuid,'DETIC'),('${outsider}'::uuid,'OUTRA ÁREA'),('${secondManager}'::uuid,'DETIC')) u(user_id,area)
      cross join os_access_profiles p where p.key='area_manager';
      insert into os_orders(id,title,unit_id,opened_by,category_id,status) values('${order}','Solicitação DETIC','${unit}','${requester}','${category}','Aberta'),('${otherOrder}','Solicitação outra área','${unit}','${admin}','${otherCategory}','Aberta');`);
    assert.deepEqual(await current(),[{order_id:order,responsible_name:"Gestor DETIC, Segundo gestor DETIC",responsible_kind:"area_manager"}]);
    assert.equal((await current(manager,[order,otherOrder])).length,1);
    assert.deepEqual(await current(outsider,[order]),[]);
    assert.equal((await current(requester,[order,otherOrder])).length,1);
    assert.deepEqual(await current(requester,[]),[]);
    await assert.rejects(current(""),/Acesso negado/);
    await assert.rejects(current(admin,Array(101).fill(order)),/Lista de ordens inválida/);
    await db.query("update os_memberships set active=false where user_id=$1",[secondManager]);
    assert.equal((await current())[0].responsible_name,"Gestor DETIC");
    const membership=(await db.query("select id from os_memberships where user_id=$1",[tech])).rows[0].id;
    const nextMembership=(await db.query("select id from os_memberships where user_id=$1",[nextTech])).rows[0].id;
    await as(manager,"select os_start_triage($1,1)",[order]);
    await as(manager,"select os_assign_order($1,2,$2)",[order,membership]);
    assert.deepEqual(await current(),[{order_id:order,responsible_name:"Profissional atual",responsible_kind:"responsible"}]);
    await as(manager,"select os_reassign_order($1,3,$2,'Troca de responsável')",[order,nextMembership]);
    assert.equal((await current())[0].responsible_name,"Próximo profissional");
    await as(nextTech,"select os_acknowledge_dispatch(id) from os_order_dispatches where os_id=$1 and ciente_em is null",[order]);
    await as(nextTech,"select os_accept_assignment($1,4)",[order]);
    await as(nextTech,"select os_start_service($1,5)",[order]);
    await as(nextTech,"select os_service_operation($1,6,'RETURN_TRIAGE','Reavaliar solicitação','observação técnica')",[order]);
    assert.equal((await current())[0].responsible_name,"Gestor DETIC");
    const returned = (await as(manager,"select status,responsible_id,responsible_membership_id,destination_unit_id,version from os_orders where id=$1",[order])).rows[0];
    assert.equal(returned.status,"Em triagem");
    assert.equal(returned.version,7);
    for (const field of ["responsible_id","responsible_membership_id","destination_unit_id"]) assert.equal(returned[field],null);
    const actions=(await as(manager,"select * from os_order_available_actions($1)",[order])).rows;
    assert.ok(actions.some(row=>row.operation==="ASSIGN"));
    const options=(await as(manager,"select * from os_order_responsible_options($1)",[order])).rows;
    assert.deepEqual(new Set(options.map(row=>row.id)),new Set([membership,nextMembership]));
    for (const unauthorized of [outsider,unitManager,requester,nextTech]) {
      await assert.rejects(as(unauthorized,"select os_assign_order($1,7,$2)",[order,membership]),/Acesso negado|Ação não permitida/);
      await assert.rejects(as(unauthorized,"select * from os_order_responsible_options($1)",[order]),/Acesso negado/);
    }
    await assert.rejects(as(manager,"select os_assign_order($1,6,$2)",[order,membership]),/alterada/);
    await as(manager,"select os_assign_order($1,7,$2)",[order,membership]);
    await assert.rejects(as(manager,"select os_assign_order($1,7,$2)",[order,membership]),/alterada/);
    assert.equal((await current())[0].responsible_name,"Profissional atual");
    assert.equal((await as(tech,"select count(*)::int n from os_order_dispatches where os_id=$1 and ciente_em is null",[order])).rows[0].n,2);
    assert.equal((await db.query("select count(*)::int n from os_order_events where order_id=$1 and event_type='order_returned_triage'",[order])).rows[0].n,1);
    await as(manager,"select os_service_operation($1,8,'RETURN_TRIAGE','Nova revisão da triagem','observação técnica')",[order]);
    await db.query("update os_memberships set active=false where user_id=$1",[manager]);
    assert.deepEqual(await current(),[{order_id:order,responsible_name:null,responsible_kind:null}]);
    await db.query("update os_orders set active=false where id=$1",[order]);
    assert.deepEqual(await current(admin),[]);
  } finally { await db.close(); }
});
