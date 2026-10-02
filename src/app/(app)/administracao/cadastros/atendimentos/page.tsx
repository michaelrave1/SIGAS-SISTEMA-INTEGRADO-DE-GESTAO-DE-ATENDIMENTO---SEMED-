import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { session } from "@/lib/session";
import { requirePagePermission } from "@/lib/authorization";
import { ensureQuerySucceeded } from "@/lib/errors";
import { Heading, Notice, Pagination } from "@/components/ui";
import { pageNumber, pageRange } from "@/lib/pagination";
import {
  saveServiceEntryType,
  deleteSystemCatalog,
} from "@/app/actions/system-catalogs";

export default async function ServiceTypes({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; erro?: string; page?: string }>;
}) {
  const { db, admin } = await session();
  if (!admin) redirect("/sem-acesso");
  await requirePagePermission("system_catalogs.manage", db);
  const p = await searchParams;
  const page = pageNumber(p.page),
    range = pageRange(page);
  const result = await db
    .from("os_service_entry_types")
    .select("*", { count: "exact" })
    .order("sort_order")
    .order("name")
    .range(range.from, range.to);
  ensureQuerySucceeded(result, "Falha ao consultar tipos de atendimento");
  const edit =
    p.edit && z.uuid().safeParse(p.edit).success
      ? await db
          .from("os_service_entry_types")
          .select("*")
          .eq("id", p.edit)
          .single()
      : null;
  if (edit) ensureQuerySucceeded(edit, "Tipo indisponível");
  const item = edit?.data;
  return (
    <>
      <Heading
        title="Tipos de Registro de Atendimento"
        description="Tipos utilizados no Registro formal de atendimento das OS. O encerramento é realizado em Ação do atendimento. A desativação impede novos registros e preserva o histórico. Alterar o nome não modifica registros anteriores."
      />
      {p.erro === "referenced" ? (
        <p role="alert">
          Este cadastro possui referências históricas. Desative-o em vez de
          excluir.
        </p>
      ) : (
        <Notice error={p.erro} />
      )}
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Ordem</th>
              <th>Situação</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.sort_order}</td>
                <td>{row.active ? "Ativo" : "Inativo"}</td>
                <td>
                  <Link href={`?edit=${row.id}`}>Editar</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={page}
          total={result.count ?? 0}
          base="/administracao/cadastros/atendimentos"
        />
      </section>
      <section className="card">
        <h2>{item ? "Editar tipo" : "Novo tipo"}</h2>
        <form
          action={saveServiceEntryType}
          className="form-grid"
          key={item?.id ?? "new"}
        >
          <input type="hidden" name="id" value={item?.id ?? ""} />
          <label>
            Nome
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={item?.name ?? ""}
            />
          </label>
          <label>
            Ordem
            <input
              name="sort_order"
              type="number"
              min={0}
              max={9999}
              required
              defaultValue={item?.sort_order ?? 0}
            />
          </label>
          <label className="checkbox">
            <input
              name="active"
              type="checkbox"
              defaultChecked={item?.active ?? true}
            />
            Tipo ativo
          </label>
          <div>
            <button>Salvar</button>{" "}
            <Link href="/administracao/cadastros/atendimentos">Novo tipo</Link>
          </div>
        </form>
        {item && (
          <details>
            <summary>Excluir tipo sem referências</summary>
            <form action={deleteSystemCatalog}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="kind" value="service_type" />
              <label className="checkbox">
                <input name="confirm" type="checkbox" required />
                Confirmo a exclusão deste tipo.
              </label>
              <button>Excluir tipo</button>
            </form>
          </details>
        )}
      </section>
    </>
  );
}
