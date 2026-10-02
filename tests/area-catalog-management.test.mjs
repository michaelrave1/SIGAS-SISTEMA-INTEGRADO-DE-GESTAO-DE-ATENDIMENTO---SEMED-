import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const dir = new URL("../supabase/migrations/", import.meta.url);
test("gestores administram somente classificações da área e transporte autorizado", async () => {
  const db = new PGlite();
  const id = (n) => "92000000-0000-4000-a000-" + String(n).padStart(12, "0");
  const admin = id(1),
    transport = id(2),
    detic = id(3),
    tech = id(4),
    unit = id(5);
  const asUser = async (user, sql, args = []) => {
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`,
    );
    try {
      return await db.query(sql, args);
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)",
      );
    }
  };
  const save = (user, kind, area, target = null, active = true) =>
    asUser(user, "select os_save_catalog($1,$2,$3,$4,$5) id", [
      target,
      kind,
      "TESTE " + kind,
      kind === "logistics" ? { area, nature: "NATUREZA", type: "TIPO" } : {},
      active,
    ]);
  try {
    await db.exec(`      create role anon;
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
    for (const file of (await fs.readdir(dir))
      .filter(
        (n) => n.endsWith(".sql") && !n.endsWith("_performance_indexes.sql"),
      )
      .sort())
      await db.exec(await fs.readFile(new URL(file, dir), "utf8"));
    await db.exec(`insert into auth.users(id) values('${admin}'),('${transport}'),('${detic}'),('${tech}');
 insert into os_profiles(id,name) select id,'Teste' from auth.users;
 insert into os_units(id,name) values('${unit}','UNIDADE');
 insert into os_catalogs(legacy_id,kind,name,data) values('TC','logistics','Transporte','{"area":"TRANSPORTE ESCOLAR"}'),('DC','logistics','Detic','{"area":"DETIC"}');
 insert into os_memberships(user_id,unit_id,role,area,access_profile_id) values
 ('${admin}',null,'admin',null,null),
 ('${transport}',null,'gestor','TRANSPORTE ESCOLAR',(select id from os_access_profiles where key='area_manager')),
 ('${detic}',null,'gestor','DETIC',(select id from os_access_profiles where key='area_manager')),
 ('${tech}','${unit}','responsavel','DETIC',null);`);
    assert.deepEqual(
      (await asUser(detic, "select os_catalog_management_scope() scope"))
        .rows[0].scope,
      { areas: ["DETIC"], kinds: ["logistics"] },
    );
    assert.deepEqual(
      (await asUser(transport, "select os_catalog_management_scope() scope"))
        .rows[0].scope.kinds,
      ["logistics", "routes", "vehicles", "drivers"],
    );
    for (const kind of ["routes", "vehicles", "drivers"]) {
      const item = (await save(transport, kind)).rows[0].id;
      await save(transport, kind, null, item, false);
      assert.equal(
        (
          await asUser(
            transport,
            "select active from os_catalogs where id=$1",
            [item],
          )
        ).rows[0].active,
        false,
      );
      await assert.rejects(save(detic, kind, null, item), /Acesso negado/);
      await assert.rejects(
        asUser(detic, "select os_delete_catalog($1)", [item]),
        /Acesso negado/,
      );
      await asUser(transport, "select os_delete_catalog($1)", [item]);
    }
    const own = (await save(detic, "logistics", "DETIC")).rows[0].id;
    await save(detic, "logistics", "DETIC", own, false);
    await assert.rejects(
      save(transport, "logistics", "DETIC", own),
      /Acesso negado/,
    );
    await assert.rejects(
      save(detic, "logistics", "TRANSPORTE ESCOLAR", own),
      /Acesso negado/,
    );
    await assert.rejects(save(detic, "logistics", "OUTRA"), /Acesso negado/);
    await assert.rejects(save(tech, "logistics", "DETIC"), /Acesso negado/);
    await asUser(detic, "select os_delete_catalog($1)", [own]);
    const other = (await save(admin, "logistics", "OUTRA")).rows[0].id;
    await assert.rejects(
      save(detic, "logistics", "DETIC", other),
      /Acesso negado/,
    );
    await asUser(admin, "select os_delete_catalog($1)", [other]);
    await assert.rejects(
      asUser(transport, "update os_catalogs set active=false"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
