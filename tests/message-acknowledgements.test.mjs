import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pendingAcknowledgementsSchema } from "../src/lib/order-acknowledgements.ts";

test("mensagens: destinatários, múltiplas ciências, RLS, idempotência, histórico e encaminhamento", async () => {
  const db = new PGlite();
  const id = (n) => `95000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
  const admin = id(1),
    requester = id(2),
    tech = id(3),
    manager = id(4),
    unitManager = id(5),
    outsider = id(6),
    otherTech = id(7),
    inactive = id(8),
    unit = id(9),
    category = id(10),
    order = id(11);
  const as = async (user, sql, args = []) => {
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`,
    );
    try {
      return await db.query(sql, args);
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)",
      );
    }
  };
  const pending = async (user) =>
    (await as(user, "select os_pending_all_acknowledgements() items")).rows[0]
      .items;
  const message = async (user, body, request = id(100), target = order) =>
    (
      await as(user, "select os_add_message($1,$2,$3) id", [
        target,
        body,
        request,
      ])
    ).rows[0].id;
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
    const repair = "202610060001_message_acknowledgements.sql";
    for (const file of (await fs.readdir(directory))
      .filter(
        (name) =>
          name.endsWith(".sql") &&
          name < repair &&
          !name.endsWith("_performance_indexes.sql"),
      )
      .sort())
      await db.exec(await fs.readFile(new URL(file, directory), "utf8"));
    await db.exec(`insert into auth.users values('${admin}'),('${requester}'),('${tech}'),('${manager}'),('${unitManager}'),('${outsider}'),('${otherTech}'),('${inactive}');
      insert into os_profiles(id,name) select id,'Pessoa de teste' from auth.users;
      insert into os_units(id,name) values('${unit}','UNIDADE');
      insert into os_catalogs(id,legacy_id,kind,name,data) values('${category}','SCIENCE-DETIC','logistics','DETIC','{"area":"DETIC"}');
      insert into os_memberships(user_id,unit_id,role,area) values('${admin}',null,'admin',null),('${requester}','${unit}','solicitante',null),('${tech}','${unit}','responsavel','DETIC'),('${otherTech}','${unit}','responsavel','DETIC'),('${unitManager}','${unit}','gestor',null);
      insert into os_memberships(user_id,unit_id,role,area,access_profile_id)
      select u.user_id,null,'gestor',u.area,p.id from (values('${manager}'::uuid,'DETIC'),('${outsider}'::uuid,'OUTRA ÁREA'),('${inactive}'::uuid,'DETIC')) u(user_id,area) cross join os_access_profiles p where p.key='area_manager';
      update os_memberships set active=false where user_id='${inactive}';
      insert into os_orders(id,title,unit_id,opened_by,category_id,status) values('${order}','Solicitação','${unit}','${requester}','${category}','Em triagem');`);
    await message(admin, "Mensagem histórica", id(99));
    await db.exec(await fs.readFile(new URL(repair, directory), "utf8"));
    assert.deepEqual(await pending(requester), []);
    const techMembership = (
      await db.query("select id from os_memberships where user_id=$1", [tech])
    ).rows[0].id;
    await as(manager, "select os_assign_order($1,1,$2)", [
      order,
      techMembership,
    ]);
    const first = await message(admin, "Primeira mensagem", id(100));
    assert.equal(await message(admin, "Primeira mensagem", id(100)), first);
    await assert.rejects(
      message(admin, "Outra mensagem com mesmo identificador", id(100)),
      /Identificador/,
    );
    const recipients = (
      await db.query(
        "select recipient_id from os_message_acknowledgements where message_id=$1",
        [first],
      )
    ).rows.map((row) => row.recipient_id);
    assert.deepEqual(
      new Set(recipients),
      new Set([requester, tech, manager, unitManager]),
    );
    assert.deepEqual(await pending(admin), []);
    assert.deepEqual(await pending(outsider), []);
    assert.deepEqual(await pending(otherTech), []);
    assert.deepEqual(await pending(inactive), []);
    const mixed = await pending(tech);
    assert.deepEqual(
      new Set(mixed.map((row) => row.kind)),
      new Set(["dispatch", "message"]),
    );
    assert.equal(pendingAcknowledgementsSchema.parse(mixed).length, 2);
    const second = await message(admin, "Segunda mensagem", id(101));
    const requestPending = await pending(requester);
    assert.equal(requestPending.length, 2);
    assert.equal(requestPending[0].body, "Primeira mensagem");
    const receipt = requestPending.find(
      (row) => row.body === "Primeira mensagem",
    ).id;
    await assert.rejects(
      as(outsider, "select os_acknowledge_message($1)", [receipt]),
      /Acesso negado/,
    );
    await assert.rejects(
      as(otherTech, "select os_acknowledge_message($1)", [receipt]),
      /Acesso negado/,
    );
    assert.equal(
      (await as(outsider, "select id from os_message_acknowledgements")).rows
        .length,
      0,
    );
    await assert.rejects(
      as(
        requester,
        "update os_message_acknowledgements set acknowledged_at=now()",
      ),
      /permission denied/,
    );
    const time = (
      await as(requester, "select os_acknowledge_message($1) time", [receipt])
    ).rows[0].time;
    assert.ok(time);
    assert.deepEqual(
      (await as(requester, "select os_acknowledge_message($1) time", [receipt]))
        .rows[0].time,
      time,
    );
    assert.equal((await pending(requester)).length, 1);
    assert.equal((await pending(tech)).length, 3);
    const secondOrder = id(12);
    await db.query(
      "insert into os_orders(id,title,unit_id,opened_by,category_id,status) values($1,'Outra solicitação',$2,$3,$4,'Aberta')",
      [secondOrder, unit, requester, category],
    );
    await message(admin, "Mensagem de outra OS", id(103), secondOrder);
    const multipleOrders = await pending(requester);
    assert.deepEqual(
      new Set(multipleOrders.map((item) => item.os_id)),
      new Set([order, secondOrder]),
    );
    await as(requester, "select os_acknowledge_message($1)", [
      multipleOrders.find((item) => item.os_id === secondOrder).id,
    ]);
    assert.equal((await pending(requester)).length, 1);
    const event = (
      await as(requester, "select * from os_order_timeline($1,100,0)", [order])
    ).rows.filter((row) => row.event_type === "message_acknowledged");
    assert.equal(event.length, 1);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from os_audit where entity='os_message_acknowledgements' and action='UPDATE'",
        )
      ).rows[0].n,
      2,
    );
    const reply = await message(requester, "Resposta do solicitante", id(102));
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from os_message_acknowledgements where message_id=$1 and recipient_id=$2",
          [reply, requester],
        )
      ).rows[0].n,
      0,
    );
    await db.query("update os_memberships set active=false where user_id=$1", [
      manager,
    ]);
    assert.deepEqual(await pending(manager), []);
    const managerReceipt = (
      await db.query(
        "select id from os_message_acknowledgements where recipient_id=$1 limit 1",
        [manager],
      )
    ).rows[0].id;
    await assert.rejects(
      as(manager, "select os_acknowledge_message($1)", [managerReceipt]),
      /Acesso negado/,
    );
    // Encerrar não apaga a ciência pendente de mensagens recebidas.
    for (const item of await pending(tech))
      await as(
        tech,
        item.kind === "message"
          ? "select os_acknowledge_message($1)"
          : "select os_acknowledge_dispatch($1)",
        [item.id],
      );
    await as(tech, "select os_accept_assignment($1,2)", [order]);
    await as(tech, "select os_start_service($1,3)", [order]);
    await as(
      tech,
      "select os_add_service_entry($1,4,'observação técnica','Atendimento realizado',now())",
      [order],
    );
    await as(
      tech,
      "select os_complete_order($1,5,'Serviço concluído','Serviço executado','')",
      [order],
    );
    assert.equal((await pending(requester)).length, 1);
    const last = (await pending(requester))[0];
    await as(requester, "select os_acknowledge_message($1)", [last.id]);
    assert.deepEqual(await pending(requester), []);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from os_messages where id in($1,$2)",
          [first, second],
        )
      ).rows[0].n,
      2,
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select os_pending_all_acknowledgements()"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
