import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const directory = new URL("../supabase/migrations/", import.meta.url);
const files = (await fs.readdir(directory))
  .filter(
    (name) =>
      name.endsWith(".sql") && !name.endsWith("_performance_indexes.sql"),
  )
  .sort();
const acknowledgementFile = "202610010001_order_acknowledgements.sql";
for (const upgrade of [false, true])
  test(`ciência: ${upgrade ? "OS existente na implantação" : "banco limpo"}, individual, múltiplas, reencaminhamento e autorização`, async () => {
    const db = new PGlite();
    const id = (n) => "91000000-0000-4000-a000-" + String(n).padStart(12, "0");
    const admin = id(1),
      requester = id(2),
      tech1 = id(3),
      tech2 = id(4),
      unit = id(5),
      category = id(6);
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
    const pending = async (user) =>
      (await asUser(user, "select os_pending_acknowledgements() items")).rows[0]
        .items;
    const ack = async (user, target) =>
      (await asUser(user, "select os_acknowledge_dispatch($1) time", [target]))
        .rows[0].time;
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
      for (const file of files)
        if (file < acknowledgementFile)
          await db.exec(await fs.readFile(new URL(file, directory), "utf8"));
      await db.exec(`
 insert into auth.users(id) values('${admin}'),('${requester}'),('${tech1}'),('${tech2}');
 insert into os_profiles(id,name) select id,'Pessoa de teste' from auth.users;
 insert into os_units(id,name) values('${unit}','UNIDADE');
 insert into os_catalogs(id,legacy_id,kind,name,data) values('${category}','ACK-CAT','logistics','DETIC','{"area":"DETIC"}');
 insert into os_memberships(user_id,unit_id,role,area) values
 ('${admin}',null,'admin',null),('${requester}','${unit}','solicitante',null),
 ('${tech1}','${unit}','responsavel','DETIC'),('${tech2}','${unit}','responsavel','DETIC');
 `);
      const m1 = (
        await db.query("select id from os_memberships where user_id=$1", [
          tech1,
        ])
      ).rows[0].id;
      const m2 = (
        await db.query("select id from os_memberships where user_id=$1", [
          tech2,
        ])
      ).rows[0].id;
      const forward = async () => {
        const order = (
          await asUser(
            requester,
            `select os_open_order('OS para ciência','${unit}','${category}','Normal','{}',null,null,null) id`,
          )
        ).rows[0].id;
        await asUser(admin, "select os_start_triage($1,1)", [order]);
        await asUser(admin, "select os_assign_order($1,2,$2)", [order, m1]);
        return order;
      };
      let first;
      if (upgrade) first = await forward();
      await db.exec(
        await fs.readFile(new URL(acknowledgementFile, directory), "utf8"),
      );
      for (const file of files.filter(name => name > acknowledgementFile))
        await db.exec(await fs.readFile(new URL(file, directory), "utf8"));
      if (!upgrade) first = await forward();
      const one = await pending(tech1);
      assert.equal(one.length, 1);
      assert.equal(one[0].os_id, first);
      assert.deepEqual(await pending(tech2), []);
      assert.deepEqual(await pending(admin), []);
      assert.equal(
        (await asUser(tech2, "select * from os_order_dispatches")).rows.length,
        0,
      );
      await assert.rejects(ack(tech2, one[0].id), /Acesso negado/);
      await assert.rejects(ack(admin, one[0].id), /Acesso negado/);
      await assert.rejects(
        asUser(
          tech1,
          "update os_order_dispatches set ciente_em=now(),ciente_por=$1 where id=$2",
          [tech1, one[0].id],
        ),
        /permission denied/,
      );
      const time = await ack(tech1, one[0].id);
      assert.deepEqual(await ack(tech1, one[0].id), time);
      assert.deepEqual(await pending(tech1), []);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from os_order_events where order_id=$1 and event_type='order_acknowledged'",
            [first],
          )
        ).rows[0].n,
        1,
      );
      assert.deepEqual(
        (
          await db.query(
            "select status,version::int from os_orders where id=$1",
            [first],
          )
        ).rows[0],
        { status: "Encaminhada", version: 3 },
      );
      const stored = (
        await db.query(
          "select ciente_por,ciente_em,encaminhado_em from os_order_dispatches where id=$1",
          [one[0].id],
        )
      ).rows[0];
      assert.equal(stored.ciente_por, tech1);
      assert.ok(new Date(stored.ciente_em) >= new Date(stored.encaminhado_em));
      const history = (
        await asUser(tech1, "select * from os_order_timeline($1,100,0)", [
          first,
        ])
      ).rows;
      assert.ok(
        history.some(
          (e) =>
            e.event_type === "order_forwarded" &&
            e.summary.includes("Destinatário"),
        ),
      );
      assert.ok(
        history.some(
          (e) =>
            e.event_type === "order_acknowledged" && e.actor_name === "Você",
        ),
      );
      await asUser(tech1, "select os_accept_assignment($1,3)", [first]);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from os_order_dispatches where os_id=$1",
            [first],
          )
        ).rows[0].n,
        1,
      );
      await forward();
      await forward();
      const multiple = await pending(tech1);
      assert.equal(multiple.length, 2);
      await ack(tech1, multiple[0].id);
      assert.equal((await pending(tech1)).length, 1);
      await ack(tech1, multiple[1].id);
      assert.equal((await pending(tech1)).length, 0);
      await asUser(
        admin,
        "select os_reassign_order($1,4,$2,'Novo encaminhamento')",
        [first, m2],
      );
      await asUser(
        admin,
        "select os_reassign_order($1,5,$2,'Retorno ao primeiro responsável')",
        [first, m1],
      );
      const again = await pending(tech1);
      assert.equal(again.length, 1);
      assert.notEqual(again[0].id, one[0].id);
      assert.equal((await pending(tech2)).length, 1);
      await ack(tech1, one[0].id);
      assert.equal((await pending(tech1)).length, 1);
      await ack(tech1, again[0].id);
      assert.equal((await pending(tech1)).length, 0);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from os_order_dispatches where os_id=$1",
            [first],
          )
        ).rows[0].n,
        3,
      );
      const canceled = await forward();
      const canceledDispatch = (await pending(tech1))[0];
      await asUser(
        admin,
        "select os_cancel_order($1,3,'Cancelamento de teste')",
        [canceled],
      );
      assert.equal((await pending(tech1)).length, 0);
      await assert.rejects(
        ack(tech1, canceledDispatch.id),
        /não está mais aberta/,
      );
      const excluded = await forward();
      await asUser(admin, "select os_delete_order($1,3)", [excluded]);
      assert.equal((await pending(tech1)).length, 0);
      const last = await forward();
      const lastDispatch = (await pending(tech1))[0];
      await db.exec(
        "delete from os_access_profile_permissions where access_profile_id=(select id from os_access_profiles where key='responsible') and permission_id=(select id from os_permissions where key='orders.view')",
      );
      assert.deepEqual(await pending(tech1), []);
      await assert.rejects(ack(tech1, lastDispatch.id), /Acesso negado/);
      assert.ok(last);
      await db.exec("set role anon");
      await assert.rejects(
        db.query("select os_pending_acknowledgements()"),
        /permission denied/,
      );
      await db.exec("reset role");
    } finally {
      await db.close();
    }
  });
