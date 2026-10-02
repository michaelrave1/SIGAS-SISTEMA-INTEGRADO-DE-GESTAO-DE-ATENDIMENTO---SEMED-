import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  availableServiceOptions,
  serviceActionOptions,
} from "../src/lib/service-actions.ts";

test("nomes e ordem configurados preservam ações, encerramento e autorização", () => {
  const settings = [
    { operation: "COMPLETE", name: "Concluir serviço", sort_order: 0 },
    { operation: "RETURN_TRIAGE", name: "Reavaliar na triagem", sort_order: 1 },
    { operation: "INVENTED", name: "Ação indevida", sort_order: 0 },
  ];
  const options = availableServiceOptions(
    [{ operation: "RETURN_TRIAGE" }],
    0,
    settings,
  );
  assert.deepEqual(options, [
    ["COMPLETE", "Concluir serviço"],
    ["RETURN_TRIAGE", "Reavaliar na triagem"],
  ]);
  assert.deepEqual(availableServiceOptions([], 0, settings), []);
  assert.deepEqual(
    new Set(
      availableServiceOptions(
        serviceActionOptions.map(([operation]) => ({ operation })),
        1,
        settings,
      ).map(([action]) => action),
    ),
    new Set(serviceActionOptions.map(([action]) => action)),
  );
});

test("cadastro de ações: migration, RBAC, RLS, auditoria e matriz intacta", async () => {
  const db = new PGlite();
  const admin = "94000000-0000-4000-a000-000000000001",
    user = "94000000-0000-4000-a000-000000000002",
    unit = "94000000-0000-4000-a000-000000000003";
  const as = async (id, sql, args = []) => {
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`,
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
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb not null default '{}',created_at timestamptz not null default now());
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const files = (await fs.readdir(directory))
      .filter(
        (name) =>
          name.endsWith(".sql") && !name.endsWith("_performance_indexes.sql"),
      )
      .sort();
    const repair = "202610020007_service_action_presentation.sql";
    for (const file of files.filter((name) => name < repair))
      await db.exec(await fs.readFile(new URL(file, directory), "utf8"));
    await db.exec(`insert into auth.users values('${admin}'),('${user}');
      insert into os_profiles(id,name) select id,'Teste' from auth.users;
      insert into os_units(id,name) values('${unit}','UNIDADE');
      insert into os_memberships(user_id,unit_id,role) values('${admin}',null,'admin'),('${user}','${unit}','solicitante');`);
    const matrix = (
      await db.query("select * from os_private.service_workflow_matrix()")
    ).rows;
    await db.exec(await fs.readFile(new URL(repair, directory), "utf8"));
    assert.deepEqual(
      (await db.query("select * from os_private.service_workflow_matrix()"))
        .rows,
      matrix,
    );
    assert.equal(
      (await as(user, "select * from os_service_action_catalog()")).rows.length,
      serviceActionOptions.length,
    );
    await as(
      admin,
      "select os_save_service_action_setting('COMPLETE','Concluir serviço',0)",
    );
    const catalog = (
      await as(user, "select * from os_service_action_catalog()")
    ).rows;
    const completion = catalog.find((row) => row.operation === "COMPLETE");
    assert.equal(completion.name, "Concluir serviço");
    assert.equal(completion.permission, "orders.complete");
    assert.deepEqual(completion.states, ["Em atendimento"]);
    const audit = (
      await db.query(
        "select actor,before_data,after_data from os_audit where entity='os_service_action_settings'",
      )
    ).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor, admin);
    assert.equal(audit[0].before_data.name, "Encerramento do atendimento");
    assert.equal(audit[0].after_data.name, "Concluir serviço");
    await as(
      admin,
      "select os_save_service_action_setting('COMPLETE','Concluir serviço',0)",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from os_audit where entity='os_service_action_settings'",
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      as(
        user,
        "select os_save_service_action_setting('COMPLETE','Indevido',0)",
      ),
      /Acesso negado/,
    );
    await assert.rejects(
      as(admin, "update os_service_action_settings set name='Direto'"),
      /permission denied/,
    );
    await assert.rejects(
      as(admin, "delete from os_service_action_settings"),
      /permission denied/,
    );
    for (const args of [
      ["COMPLETE", "", 0],
      ["COMPLETE", "Nome", -1],
      ["INVENTED", "Nome", 0],
    ])
      await assert.rejects(
        as(admin, "select os_save_service_action_setting($1,$2,$3)", args),
        /inválidos|inexistente/,
      );
    await assert.rejects(
      as("", "select * from os_service_action_catalog()"),
      /Acesso negado/,
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from os_service_action_catalog()"),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select * from os_private.service_workflow_matrix()"))
        .rows,
      matrix,
    );
  } finally {
    await db.close();
  }
});
