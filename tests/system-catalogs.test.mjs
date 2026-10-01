import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const directory = new URL("../supabase/migrations/", import.meta.url);
const migration = await fs.readFile(
  new URL("202609300001_system_catalogs.sql", directory),
  "utf8",
);
const previous = (await fs.readdir(directory))
  .filter(
    (name) =>
      name.endsWith(".sql") &&
      name < "202609300001" &&
      !name.endsWith("_performance_indexes.sql"),
  )
  .sort();

for (const withHistory of [false, true])
  test(`cadastros: ${withHistory ? "upgrade com histórico" : "banco limpo"}, RBAC, RLS e ciclo de vida`, async () => {
    const db = new PGlite();
    const admin = "81000000-0000-4000-a000-000000000001";
    const user = "81000000-0000-4000-a000-000000000002";
    const unit = "81000000-0000-4000-a000-000000000003";
    const category = "81000000-0000-4000-a000-000000000004";
    const asUser = async (id, sql, args = []) => {
      await db.exec(
        `set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
      );
      try {
        return await db.query(sql, args);
      } finally {
        await db.exec(
          "reset role; select set_config('request.jwt.claim.sub','',false)",
        );
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
      for (const name of previous)
        await db.exec(await fs.readFile(new URL(name, directory), "utf8"));
      await db.exec(`
 insert into auth.users values ('${admin}'),('${user}');
 insert into os_profiles(id,name) select id,'Teste' from auth.users;
 insert into os_units(id,name) values ('${unit}','ESCOLA');
 insert into os_memberships(user_id,unit_id,role) values ('${admin}',null,'admin'),('${user}','${unit}','solicitante');
 insert into os_catalogs(id,legacy_id,kind,name,data) values ('${category}','TEST-CATALOG','logistics','DETIC','{"area":"DETIC"}');
 `);
      if (withHistory) {
        const oldOrder = (
          await asUser(
            user,
            `select os_open_order('OS legada','${unit}','${category}','Normal','{}',null,null,null) id`,
          )
        ).rows[0].id;
        await db.query(
          "insert into os_order_service_entries(order_id,entry_type,description,serviced_at) values($1,'TIPO IMPORTADO','Registro antigo',now())",
          [oldOrder],
        );
      }
      await db.exec(migration);
      if (withHistory) {
        assert.deepEqual(
          (
            await db.query(
              "select key,active from os_service_entry_types where key='TIPO IMPORTADO'",
            )
          ).rows,
          [{ key: "TIPO IMPORTADO", active: false }],
        );
        assert.deepEqual(
          (
            await db.query(
              "select entry_type,entry_type_name from os_order_service_entries where entry_type='TIPO IMPORTADO'",
            )
          ).rows,
          [{ entry_type: "TIPO IMPORTADO", entry_type_name: null }],
        );
      }
      assert.equal(
        (await db.query("select count(*)::int n from os_service_entry_types"))
          .rows[0].n,
        withHistory ? 6 : 5,
      );
      await assert.rejects(
        asUser(user, "select os_save_service_entry_type(null,'NOVO',true,1)"),
        /Acesso negado/,
      );
      await assert.rejects(
        asUser(
          user,
          "insert into os_service_entry_types(key,name) values('FORJADO','FORJADO')",
        ),
        /permission denied/,
      );
      const created = (
        await asUser(
          admin,
          "select os_save_service_entry_type(null,'NOVO',true,1) id",
        )
      ).rows[0].id;
      await asUser(
        admin,
        "select os_save_service_entry_type($1,'RENOMEADO',false,5)",
        [created],
      );
      assert.deepEqual(
        (
          await db.query(
            "select key,name,active,sort_order from os_service_entry_types where id=$1",
            [created],
          )
        ).rows,
        [{ key: "NOVO", name: "RENOMEADO", active: false, sort_order: 5 }],
      );
      await asUser(
        admin,
        "select os_save_service_entry_type($1,'RENOMEADO',true,5)",
        [created],
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from os_audit where entity='os_service_entry_types' and record_id=$1",
            [created],
          )
        ).rows[0].n,
        3,
      );
      const order = (
        await asUser(
          user,
          `select os_open_order('Teste histórico','${unit}','${category}','Normal','{}',null,null,null) id`,
        )
      ).rows[0].id;
      await assert.rejects(
        asUser(user, "select os_delete_catalog($1)", [category]),
        /Acesso negado/,
      );
      await assert.rejects(
        asUser(admin, "select os_delete_catalog($1)", [category]),
        /referência histórica/,
      );
      await assert.rejects(
        db.query(
          'update os_catalogs set data=\'{"area":"OUTRA"}\' where id=$1',
          [category],
        ),
        /Área imutável/,
      );
      await db.query("update os_catalogs set active=false where id=$1", [
        category,
      ]);
      assert.equal(
        (await asUser(user, "select id from os_orders where id=$1", [order]))
          .rows.length,
        1,
      );
      await assert.rejects(
        asUser(admin, "select os_delete_unit($1)", [unit]),
        /referência histórica/,
      );
      const insertEntry = (type) =>
        db.query(
          "insert into os_order_service_entries(order_id,entry_type,description,serviced_at) values($1,$2,'Atendimento de teste',now())",
          [order, type],
        );
      await insertEntry("NOVO");
      assert.equal(
        (
          await db.query(
            "select entry_type_name from os_order_service_entries where order_id=$1",
            [order],
          )
        ).rows[0].entry_type_name,
        "RENOMEADO",
      );
      await asUser(
        admin,
        "select os_save_service_entry_type($1,'ATUALIZADO',false,3)",
        [created],
      );
      assert.equal(
        (
          await db.query(
            "select entry_type from os_order_service_entries where order_id=$1",
            [order],
          )
        ).rows[0].entry_type,
        "NOVO",
      );
      await assert.rejects(insertEntry("NOVO"), /inválido ou inativo/);
      await assert.rejects(insertEntry("FORJADO"), /inválido ou inativo/);
      await assert.rejects(
        asUser(admin, "select os_delete_service_entry_type($1)", [created]),
        /referência histórica|foreign key/,
      );
      await assert.rejects(
        asUser(
          admin,
          "select os_save_service_entry_type(null,'diagnóstico',true,0)",
        ),
        /já cadastrado/,
      );
      await assert.rejects(
        asUser(
          admin,
          `select os_save_catalog(null,'logistics','Inválida','{"area":"DETIC","type":"TIPO SEM NATUREZA"}',true)`,
        ),
        /hierarquia/,
      );
      const newCatalog = (
        await asUser(
          admin,
          `select os_save_catalog(null,'logistics','Nova classificação','{"area":"DETIC","nature":"SUPORTE","type":"REPARO","detail":"Computador"}',true) id`,
        )
      ).rows[0].id;
      await asUser(admin, "select os_delete_catalog($1)", [newCatalog]);
      const spareUnit = (
        await db.query(
          "insert into os_units(name) values('SEM VÍNCULO') returning id",
        )
      ).rows[0].id;
      await asUser(admin, "select os_delete_unit($1)", [spareUnit]);
      const unused = (
        await asUser(
          admin,
          "select os_save_service_entry_type(null,'SEM USO',true,0) id",
        )
      ).rows[0].id;
      await asUser(admin, "select os_delete_service_entry_type($1)", [unused]);
      await assert.rejects(
        asUser(user, "select os_delete_service_entry_type($1)", [created]),
        /Acesso negado/,
      );
      await db.exec(
        "delete from os_access_profile_permissions where access_profile_id=(select id from os_access_profiles where key='admin') and permission_id=(select id from os_permissions where key='system_catalogs.manage')",
      );
      await assert.rejects(
        asUser(
          admin,
          "select os_save_service_entry_type(null,'SEM PERMISSÃO',true,0)",
        ),
        /Acesso negado/,
      );
      await db.exec("set role anon");
      await assert.rejects(
        db.query("select * from os_service_entry_types"),
        /permission denied/,
      );
      await db.exec("reset role");
    } finally {
      await db.close();
    }
  });
