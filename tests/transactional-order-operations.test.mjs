import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrations = await Promise.all(
  (await fs.readdir(migrationsDirectory))
    .filter(
      (file) =>
        file.endsWith(".sql") && !file.endsWith("_performance_indexes.sql"),
    )
    .sort()
    .map((file) => fs.readFile(new URL(file, migrationsDirectory), "utf8")),
);

test("operações canônicas validam estado, autorização, versão e atomicidade", async () => {
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
        ('${ids.areaManager}',null,'gestor','DETIC','a2000000-0000-4000-a000-000000000001');
      insert into os_orders(id,title,status) values
        ('${ids.pending}','Pendente para conciliação','A conferir');
    `);

    const convertedManager = (
      await asUser(
        ids.admin,
        `select os_save_professional_membership(
          null,null,'gestor.area@edu.uberabadigital.com.br','Gestor para conversão',
          'M-001','Gestor','${ids.unit}','gestor',null,true,true
        ) as id`,
      )
    ).rows[0].id;
    const convertedProfessional = (
      await db.query(
        `select professional_id from os_memberships where id='${convertedManager}'`,
      )
    ).rows[0].professional_id;
    await asUser(
      ids.admin,
      `select os_save_professional_membership(
        '${convertedManager}','${convertedProfessional}',
        'gestor.area@edu.uberabadigital.com.br','Gestor para conversão',
        'M-001','Gestor','${ids.unit}','gestor_area','DETIC',true,true
      )`,
    );
    assert.deepEqual(
      (
        await db.query(
          `select m.unit_id,m.area,p.key profile_key
           from os_memberships m
           join os_access_profiles p on p.id=m.access_profile_id
           where m.id='${convertedManager}'`,
        )
      ).rows,
      [{ unit_id: null, area: "DETIC", profile_key: "area_manager" }],
    );

    await assert.rejects(
      asUser(
        ids.admin,
        `select os_start_triage('${ids.pending}',1)`,
      ),
    );
    await asUser(
      ids.admin,
      `select os_reconcile_order(
        '${ids.pending}',1,'${ids.unit}','${ids.requester}','${ids.category}'
      )`,
    );
    assert.deepEqual(
      (
        await db.query(
          `select status,version from os_orders where id='${ids.pending}'`,
        )
      ).rows,
      [{ status: "Em triagem", version: 2 }],
    );

    const opened = await asUser(
      ids.requester,
      `select os_open_order(
        'Fluxo transacional','${ids.unit}','${ids.category}','Normal','{}',
        null,null,null
      ) as id`,
    );
    const order = opened.rows[0].id;

    assert.deepEqual(
      (
        await asUser(
          ids.admin,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "TRIAGE" },
        { operation: "CANCEL" },
        { operation: "EDIT" },
      ],
    );
    assert.deepEqual(
      (
        await asUser(
          ids.requester,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [],
    );

    await db.exec(`
      create function public.reject_test_event() returns trigger language plpgsql as $$
      begin
        if new.event_type='triage_started' then raise exception 'Falha simulada'; end if;
        return new;
      end $$;
      create trigger reject_test_event before insert on os_order_events
      for each row execute function public.reject_test_event();
    `);
    await assert.rejects(
      asUser(ids.admin, `select os_start_triage('${order}',1)`),
    );
    assert.deepEqual(
      (await db.query(`select status,version from os_orders where id='${order}'`))
        .rows,
      [{ status: "Aberta", version: 1 }],
    );
    await db.exec(
      "drop trigger reject_test_event on os_order_events; drop function public.reject_test_event();",
    );

    await asUser(ids.areaManager, `select os_start_triage('${order}',1)`);
    assert.deepEqual(
      (
        await asUser(
          ids.admin,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "ASSIGN" },
        { operation: "WAIT_INFORMATION" },
        { operation: "CANCEL" },
        { operation: "EDIT" },
      ],
    );
    const memberships = await db.query(
      `select user_id,id from os_memberships
       where user_id in ('${ids.tech1}','${ids.tech2}')`,
    );
    const tech1Membership = memberships.rows.find(
      (row) => row.user_id === ids.tech1,
    ).id;
    const tech2Membership = memberships.rows.find(
      (row) => row.user_id === ids.tech2,
    ).id;
    await asUser(
      ids.areaManager,
      `select os_assign_order('${order}',2,'${tech1Membership}')`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech1,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "ACCEPT_ASSIGNMENT" },
      ],
    );
    assert.deepEqual(
      (
        await asUser(
          ids.admin,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "REASSIGN" },
        { operation: "WAIT_INFORMATION" },
        { operation: "CANCEL" },
        { operation: "EDIT" },
      ],
    );
    assert.equal(
      (await asUser(ids.tech1, `select id from os_orders where id='${order}'`))
        .rows.length,
      1,
    );
    await asUser(ids.tech1, `select os_accept_assignment('${order}',3)`);
    await asUser(
      ids.areaManager,
      `select os_reassign_order('${order}',4,'${tech2Membership}','Troca de escala')`,
    );
    await assert.rejects(
      asUser(ids.tech1, `select os_start_service('${order}',5)`),
    );
    assert.deepEqual(
      (await db.query(
        `select status,responsible_id,responsible_membership_id,version
         from os_orders where id='${order}'`,
      )).rows,
      [{
        status: "Encaminhada",
        responsible_id: ids.tech2,
        responsible_membership_id: tech2Membership,
        version: 5,
      }],
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [{ operation: "ACCEPT_ASSIGNMENT" }],
    );
    await asUser(ids.tech2, `select os_accept_assignment('${order}',5)`);
    await asUser(ids.tech2, `select os_start_service('${order}',6)`);
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "ADD_SERVICE_ENTRY" },
        { operation: "WAIT_INFORMATION" },
        { operation: "CANCEL" },
      ],
    );
    await assert.rejects(
      asUser(
        ids.tech2,
        `select os_complete_order('${order}',7,'Solução antes do registro')`,
      ),
    );
    assert.equal(
      (await db.query(`select version from os_orders where id='${order}'`)).rows[0]
        .version,
      7,
    );
    await asUser(
      ids.tech2,
      `select os_add_service_entry(
        '${order}',7,'diagnóstico','Diagnóstico e correção registrados',now()
      )`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [
        { operation: "ADD_SERVICE_ENTRY" },
        { operation: "WAIT_INFORMATION" },
        { operation: "COMPLETE" },
        { operation: "CANCEL" },
      ],
    );
    await asUser(
      ids.tech2,
      `select os_wait_for_information(
        '${order}',8,'material','Aguardando material necessário'
      )`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [{ operation: "RESUME" }, { operation: "CANCEL" }],
    );
    assert.deepEqual(
      (
        await db.query(
          `select status,resume_status,waiting_reason,version
           from os_orders where id='${order}'`,
        )
      ).rows,
      [
        {
          status: "Aguardando informação",
          resume_status: "Em atendimento",
          waiting_reason: "material",
          version: 9,
        },
      ],
    );
    await assert.rejects(
      asUser(ids.tech2, `select os_resume_service('${order}',8)`),
    );
    await asUser(ids.tech2, `select os_resume_service('${order}',9)`);
    await asUser(
      ids.tech2,
      `select os_complete_order('${order}',10,'Equipamento normalizado')`,
    );
    assert.deepEqual(
      (
        await asUser(
          ids.tech2,
          `select operation from os_order_available_actions('${order}')`,
        )
      ).rows,
      [{ operation: "REOPEN" }],
    );
    await assert.rejects(
      asUser(
        ids.outsider,
        `select os_reopen_order('${order}',11,'Nova ocorrência')`,
      ),
    );
    await asUser(
      ids.admin,
      `select os_reopen_order('${order}',11,'Nova ocorrência')`,
    );
    await assert.rejects(
      asUser(
        ids.admin,
        `select os_edit_order_controlled(
          '${order}',12,'Fluxo transacional','Alta','','{}'
        )`,
      ),
    );
    await asUser(
      ids.admin,
      `select os_edit_order_controlled(
        '${order}',12,'Fluxo transacional revisado','Alta','Impacto confirmado','{}'
      )`,
    );
    await asUser(
      ids.admin,
      `select os_cancel_order('${order}',13,'Solicitação substituída')`,
    );
    await assert.rejects(
      asUser(
        ids.admin,
        `select os_cancel_order('${order}',14,'Cancelamento repetido')`,
      ),
    );

    assert.deepEqual(
      (
        await db.query(
          `select status,version,legacy_id from os_orders where id='${order}'`,
        )
      ).rows,
      [{ status: "Cancelada", version: 14, legacy_id: null }],
    );
    assert.equal(
      Number(
        (
          await db.query(
            `select count(*)::integer as count from os_order_events
             where order_id='${order}' and operation is not null`,
          )
        ).rows[0].count,
      ),
      14,
    );
    await assert.rejects(
      db.query(
        `update os_order_events set reason='alterado' where order_id='${order}'`,
      ),
    );
    for (const user of [ids.requester, ids.tech1, ids.areaManager]) {
      await assert.rejects(asUser(user, `select os_delete_order('${order}',14)`), /Acesso negado/);
    }
    await assert.rejects(asUser(ids.admin, `select os_delete_order('${order}',13)`), /alterada por outro/);
    await asUser(ids.admin, `select os_delete_order('${order}',14)`);
    assert.deepEqual((await db.query(`select active,version from os_orders where id='${order}'`)).rows,
      [{ active: false, version: 15 }]);
    assert.equal((await asUser(ids.admin, `select id from os_orders where id='${order}'`)).rows.length, 0);
    assert.equal((await db.query(`select id from os_audit where record_id='${order}' and action='DELETE'`)).rows.length, 1);
    assert.equal(Number((await db.query(`select count(*) as n from os_order_events where order_id='${order}'`)).rows[0].n), 14);
    await assert.rejects(asUser(ids.admin, `select os_delete_order('${order}',15)`), /não encontrada/);
  } finally {
    await db.close();
  }
});
