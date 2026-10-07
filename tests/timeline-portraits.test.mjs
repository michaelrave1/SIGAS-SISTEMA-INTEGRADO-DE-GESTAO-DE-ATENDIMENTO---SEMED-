import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("fotos do histórico preservam autorização, identidade ocultada e eventos visíveis", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema os_private;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create table public.os_orders(id uuid primary key);
      create table public.os_order_events(id bigint, order_id uuid, actor uuid, event_type text);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function os_private.can_read_order(o public.os_orders) returns boolean language sql as $$ select current_setting('test.read',true)='yes' $$;
      create function os_private.can_read_order_internal(o public.os_orders) returns boolean language sql as $$ select current_setting('test.internal',true)='yes' $$;
      create function os_private.can_read_order_event(id uuid, kind text) returns boolean language sql as $$ select kind <> 'hidden' $$;
      insert into public.os_orders values ('00000000-0000-4000-8000-000000000001');
      insert into auth.users values ('00000000-0000-4000-8000-000000000002','{"picture":"https://lh3.googleusercontent.com/photo"}');
      insert into public.os_order_events values
        (1,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','visible'),
        (2,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','hidden');
      set test.uid='00000000-0000-4000-8000-000000000003';
      set test.read='yes'; set test.internal='yes';
    `);
    const sql = await readFile(new URL('../supabase/migrations/202610070001_timeline_actor_portraits.sql',import.meta.url),'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const query = "select * from public.os_order_timeline_actors('00000000-0000-4000-8000-000000000001',array[1,2]::bigint[])";
    let rows = (await db.query(query)).rows;
    assert.equal(rows.length,1);
    assert.equal(rows[0].avatar_url,'https://lh3.googleusercontent.com/photo');
    await db.exec("set test.internal='no'");
    rows = (await db.query(query)).rows;
    assert.equal(rows[0].actor_key,'team');
    assert.equal(rows[0].avatar_url,null);
    await db.exec("set test.uid='00000000-0000-4000-8000-000000000002'");
    assert.equal((await db.query(query)).rows[0].avatar_url,'https://lh3.googleusercontent.com/photo');
    await db.exec("set test.read='no'");
    assert.equal((await db.query(query)).rows.length,0);
    await db.exec("set test.uid=''");
    await assert.rejects(db.query(query), /Acesso negado/);
  } finally { await db.close(); }
});
