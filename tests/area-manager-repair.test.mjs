import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrations = await Promise.all(
  (await fs.readdir(migrationsDirectory))
    .filter(
      (file) =>
        file.endsWith(".sql") && !file.includes("202609290005") && !file.endsWith("_performance_indexes.sql"),
    )
    .sort()
    .map((file) => fs.readFile(file.startsWith("202609290001") ? new URL("./fixtures/production-202609290001.sql", import.meta.url) : new URL(file, migrationsDirectory), "utf8")),
);

test("correção idempotente do gestor de área no schema divergente", async () => {
  const db = new PGlite();
  const ids = {
    admin: "10000000-0000-4000-a000-000000000001",
    requester: "10000000-0000-4000-a000-000000000002",
    tech1: "10000000-0000-4000-a000-000000000003",
    tech2: "10000000-0000-4000-a000-000000000004",
    outsider: "10000000-0000-4000-a000-000000000005",
    areaManager: "10000000-0000-4000-a000-000000000010",
    unit: "10000000-0000-4000-a000-000000000006",
    category: "10000000-0000-4000-a000-000000000007",
    pending: "10000000-0000-4000-a000-000000000008",
    executionUnit: "10000000-0000-4000-a000-000000000009",
  };
  const asUser = async (user, sql) => {
    await db.exec(
      `reset role; set role authenticated;
       select set_config('request.jwt.claim.sub','${user}',false);`,
    );
    try {
      return await db.query(sql);
    } finally {
      await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);");
    }
  };
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create schema storage;
      create table storage.buckets(
        id text primary key,name text,public boolean,file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects(
        id uuid default gen_random_uuid(),bucket_id text,name text,
        metadata jsonb not null default '{}',created_at timestamptz not null default now()
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert on storage.objects to authenticated;
    `);
    await db.exec(migrations.join("\n"));
    await db.exec(`
      insert into auth.users(id) values
        ('${ids.admin}'),('${ids.requester}'),('${ids.tech1}'),
        ('${ids.tech2}'),('${ids.outsider}'),('${ids.areaManager}');
      insert into os_profiles(id,name) select id,'Teste' from auth.users;
      insert into os_units(id,name) values
        ('${ids.unit}','Unidade solicitante'),
        ('${ids.executionUnit}','Unidade executora');
      insert into os_catalogs(id,legacy_id,kind,name,data)
        values('${ids.category}','CAT-TX','logistics','Categoria','{"area":"DETIC"}');
      insert into os_memberships(user_id,unit_id,role,area,access_profile_id) values
        ('${ids.admin}',null,'admin',null,null),
        ('${ids.requester}','${ids.unit}','solicitante',null,null),
        ('${ids.tech1}','${ids.executionUnit}','responsavel','DETIC',null),
        ('${ids.tech2}','${ids.executionUnit}','responsavel','DETIC',null),
        ('${ids.outsider}','${ids.unit}','solicitante',null,null),
        ('${ids.areaManager}','${ids.unit}','gestor',null,null);
      insert into os_orders(id,title,status) values
        ('${ids.pending}','Pendente para conciliação','A conferir');
    `);

    const migration = await fs.readFile(new URL("../supabase/migrations/202609290005_reconcile_area_manager.sql", import.meta.url), "utf8");
    assert.equal((await db.query("select to_regclass('public.os_order_area_assignments') name")).rows[0].name, null);
    // A versão anterior não criava a tabela: reproduz 42P01 e verifica rollback.
    const broken = migration.replace(/create table if not exists public.os_order_area_assignments[\s\S]*?on public.os_order_area_assignments\(membership_id,order_id\);/, "");
    await assert.rejects(db.exec(broken), error => error.code === "42P01");
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::int n from os_access_profiles where key='area_manager'")).rows[0].n, 0);
    const member = (await db.query(`select * from os_memberships where user_id='${ids.areaManager}'`)).rows[0];
    const save = (role,area,user=ids.admin) => asUser(user,`select os_save_professional_membership(
      '${member.id}','${member.professional_id}','','Teste','','','${ids.unit}',
      '${role}',${area === null ? 'null' : "'"+area+"'"},true,true)`);
    await assert.rejects(save("gestor_area","DETIC"), /Perfil de acesso inválido ou inativo/);
    await save("gestor",null);
    const existingOrder = (await asUser(ids.requester,`select os_open_order(
      'OS anterior à correção','${ids.unit}','${ids.category}','Normal','{}',null,null,null) id`)).rows[0].id;
    const before = (await db.query(`select * from os_memberships where id='${member.id}'`)).rows;
    await db.exec(migration);
    assert.equal((await db.query(`select count(*)::int n from os_order_area_assignments where order_id='${existingOrder}'`)).rows[0].n,2);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.os_order_area_assignments'::regclass")).rows[0].relrowsecurity,true);
    await assert.rejects(asUser(ids.requester,"select * from os_order_area_assignments"), /permission denied/);
    await db.exec(`insert into os_access_profile_permissions(access_profile_id,permission_id)
      select p.id,q.id from os_access_profiles p cross join os_permissions q
      where p.key='area_manager' and q.key='professionals.manage'`);
    await db.exec(migration);
    assert.deepEqual((await db.query(`select * from os_memberships where id='${member.id}'`)).rows,before);
    assert.equal((await db.query("select count(*)::int n from os_access_profiles where key='area_manager'")).rows[0].n,1);
    assert.deepEqual((await db.query(`select q.key from os_access_profile_permissions x
      join os_permissions q on q.id=x.permission_id join os_access_profiles p on p.id=x.access_profile_id
      where p.key='area_manager' order by q.key`)).rows.map(r=>r.key),
      ["dashboard.view","logistics.view","orders.assign","orders.reassign","orders.triage","orders.view","units.view"]);
    await assert.rejects(save("gestor_area",null), /Área obrigatória/);
    await assert.rejects(save("gestor_area","INEXISTENTE"), /Área inválida/);
    await assert.rejects(save("gestor_area","DETIC",ids.requester), /Acesso negado|permissão/i);
    await save("gestor_area","DETIC");
    assert.deepEqual((await db.query(`select m.role,m.unit_id,m.area,p.key from os_memberships m
      join os_access_profiles p on p.id=m.access_profile_id where m.id='${member.id}'`)).rows,
      [{role:"gestor",unit_id:null,area:"DETIC",key:"area_manager"}]);
    assert.equal((await asUser(ids.admin,`select role from os_professional_memberships() where membership_id='${member.id}'`)).rows[0].role,"gestor_area");
    await db.exec(`insert into os_catalogs(legacy_id,id,kind,name,data) values(
      'CAT-OTHER','30000000-0000-4000-a000-000000000001','logistics','Outra área','{"area":"PATRIMÔNIO"}')`);
    const open = async category => (await asUser(ids.requester,`select os_open_order(
      'Teste isolamento','${ids.unit}','${category}','Normal','{}',null,null,null) id`)).rows[0].id;
    const own=await open(ids.category);
    const other=await open("30000000-0000-4000-a000-000000000001");
    assert.equal((await asUser(ids.areaManager,`select id from os_orders where id='${other}'`)).rows.length,0);
    assert.equal((await asUser(ids.areaManager,`select id from os_orders where id='${own}'`)).rows.length,1);
    await assert.rejects(asUser(ids.areaManager,`select os_start_triage('${other}',1)`),/Acesso negado/);
    await asUser(ids.areaManager,`select os_start_triage('${own}',1)`);
    await asUser(ids.admin,`select os_start_triage('${other}',1)`);
    const tech=(await db.query(`select id from os_memberships where user_id='${ids.tech1}'`)).rows[0].id;
    await assert.rejects(asUser(ids.areaManager,`select os_assign_order('${other}',2,'${tech}')`), /Acesso negado/);
    await asUser(ids.areaManager,`select os_assign_order('${own}',2,'${tech}')`);
    assert.equal((await db.query(`select status from os_orders where id='${own}'`)).rows[0].status,"Encaminhada");
    await save("gestor",null);
    assert.equal((await db.query(`select p.key from os_memberships m join os_access_profiles p on p.id=m.access_profile_id where m.id='${member.id}'`)).rows[0].key,"manager");
    assert.equal((await asUser(ids.areaManager,`select id from os_orders where id='${other}'`)).rows.length,1);
    await db.exec(`update os_memberships set area='PATRIMÔNIO' where id='${tech}'`);
    assert.equal((await db.query(`select count(*)::int n from os_order_area_assignments where membership_id='${tech}' and order_id='${own}'`)).rows[0].n,0);
    assert.equal((await db.query(`select count(*)::int n from os_order_area_assignments where membership_id='${tech}' and order_id='${other}'`)).rows[0].n,1);
    await assert.rejects(db.exec(`update os_catalogs set data='{"area":"DETIC"}' where id='30000000-0000-4000-a000-000000000001'`), /Área imutável/);
    assert.equal((await db.query(`select count(*)::int n from os_order_area_assignments where membership_id='${tech}' and order_id='${other}'`)).rows[0].n,1);
  } finally { await db.close(); }
});

