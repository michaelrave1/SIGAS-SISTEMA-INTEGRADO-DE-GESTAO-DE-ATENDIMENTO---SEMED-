import { ClassificationFields } from "@/components/classification-fields";
import {
  deleteSystemCatalog,
  setCatalogActive,
} from "@/app/actions/system-catalogs";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { session } from "@/lib/session";
import { catalogFields, isCatalogKind, type Catalog } from "@/lib/domain";
import { Heading, Notice, Pagination } from "@/components/ui";
import { pageNumber, pageRange } from "@/lib/pagination";
import { ensureQuerySucceeded } from "@/lib/errors";
import { fieldLimits } from "@/lib/application-config";
import { saveCatalog } from "@/app/actions";
import { getUserPermissions, requirePagePermission } from "@/lib/authorization";
import { permissionSetHas } from "@/lib/authorization-core";
import { catalogPermission } from "@/lib/authorization-policy";
export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{
    page?: string;
    edit?: string;
    q?: string;
    erro?: string;
    level?: string;
    area?: string;
    nature?: string;
    type?: string;
  }>;
}) {
  const { kind } = await params;
  if (!isCatalogKind(kind)) notFound();
  const config = catalogFields[kind];
  const p = await searchParams;
  const page = pageNumber(p.page);
  const range = pageRange(page);
  const { db, admin } = await session();
  if (!admin) redirect("/sem-acesso");
  await requirePagePermission(catalogPermission(kind, "view"), db);
  const permissions = await getUserPermissions(db);
  const canCreate =
    admin && permissionSetHas(permissions, catalogPermission(kind, "create"));
  const canUpdate =
    admin && permissionSetHas(permissions, catalogPermission(kind, "update"));
  const classifications: Catalog[] = [];
  if (kind === "logistics") {
    for (let offset = 0; ; offset += 1000) {
      const batch = await db
        .from("os_catalogs")
        .select("id,legacy_id,kind,name,data,active")
        .eq("kind", "logistics")
        .order("id")
        .range(offset, offset + 999);
      ensureQuerySucceeded(batch, "Falha ao consultar hierarquia");
      classifications.push(...(batch.data ?? []));
      if ((batch.data?.length ?? 0) < 1000) break;
    }
  }
  const hierarchy = ["area", "nature", "type", "detail"];
  const level = hierarchy.includes(p.level ?? "") ? p.level! : "area";
  const labels: Record<string, string> = {
    area: "Áreas",
    nature: "Naturezas por Área",
    type: "Tipos por Natureza",
    detail: "Descrições e Detalhamentos",
  };
  const filters = new URLSearchParams();
  for (const key of ["area", "nature", "type"] as const)
    if (p[key]) filters.set(key, p[key]!);
  filters.set("level", level);
  const filtered = classifications.filter((c) =>
    (["area", "nature", "type"] as const).every(
      (key) => !p[key] || c.data[key] === p[key],
    ),
  );
  const groups = [
    ...new Set(
      filtered
        .map((c) =>
          level === "detail"
            ? [c.data.description, c.data.detail].filter(Boolean).join(" · ") ||
              c.name
            : c.data[level as "area" | "nature" | "type"],
        )
        .filter(Boolean),
    ),
  ].sort();
  const q = (p.q ?? "").slice(0, 100);
  let query = db
    .from("os_catalogs")
    .select("id,legacy_id,kind,name,data,active", { count: "exact" })
    .eq("kind", kind)
    .order("name")
    .range(range.from, range.to);
  if (kind === "logistics")
    for (const key of ["area", "nature", "type"] as const)
      if (p[key]) query = query.eq(`data->>${key}`, p[key]!);
  if (q) query = query.ilike("name", `%${q.replace(/[%_\\]/g, "")}%`);
  const { data, error, count } = await query;
  ensureQuerySucceeded({ error }, "Falha ao consultar cadastros");
  const edit =
    canUpdate && p.edit && z.uuid().safeParse(p.edit).success
      ? await db
          .from("os_catalogs")
          .select("id,legacy_id,kind,name,data,active")
          .eq("id", p.edit)
          .eq("kind", kind)
          .single()
      : null;
  if (edit) ensureQuerySucceeded(edit, "Cadastro indisponível");
  const item = edit?.data as Catalog | undefined;
  return (
    <>
      <Heading
        title={
          kind === "logistics"
            ? "Classificações das Solicitações"
            : config.label
        }
        description="Cadastros de apoio às ordens de serviço."
      />
      <Link href="/administracao/cadastros">Cadastros do Sistema</Link>
      {p.erro === "referenced" ? (
        <p role="alert">
          Este cadastro possui histórico ou vínculos. Desative-o em vez de
          excluir.
        </p>
      ) : (
        <Notice error={p.erro} />
      )}
      {kind === "logistics" && (
        <section className="card">
          <h2>{labels[level]}</h2>
          <p>
            {[p.area, p.nature, p.type].filter(Boolean).join(" → ") ||
              "Todas as áreas"}
          </p>
          <Link href="/cadastros/logistics?level=area">
            Todas as classificações
          </Link>
          <ul>
            {groups.map((value) => {
              const next = new URLSearchParams(filters);
              next.set(level, value!);
              next.set(
                "level",
                hierarchy[Math.min(hierarchy.indexOf(level) + 1, 3)],
              );
              return (
                <li key={value}>
                  {level === "detail" ? (
                    value
                  ) : (
                    <Link href={`/cadastros/logistics?${next}`}>{value}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <form className="filters">
        {kind === "logistics" &&
          [...filters].map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
        <label>
          Buscar
          <input name="q" defaultValue={q} />
        </label>
        <button>Buscar</button>
      </form>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome / descrição</th>
              {config.fields
                .slice(0, kind === "logistics" && level === "detail" ? 5 : 3)
                .map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
              <th>Situação</th>
              {canUpdate && <th>Ação</th>}
            </tr>
          </thead>
          <tbody>
            {(data as Catalog[])?.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                {config.fields
                  .slice(0, kind === "logistics" && level === "detail" ? 5 : 3)
                  .map(([key]) => (
                    <td key={key}>{c.data[key] ?? ""}</td>
                  ))}
                <td>{c.active ? "Ativo" : "Inativo"}</td>
                {canUpdate && (
                  <td>
                    <Link href={`/cadastros/${kind}?${filters}&edit=${c.id}`}>
                      Editar
                    </Link>
                    <form action={setCatalogActive}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="kind" value={kind} />
                      <input
                        type="hidden"
                        name="active"
                        value={String(!c.active)}
                      />
                      <button>{c.active ? "Desativar" : "Ativar"}</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={page}
          total={count ?? 0}
          base={`/cadastros/${kind}?${filters}&q=${encodeURIComponent(q)}`}
        />
      </section>
      {(item ? canUpdate : canCreate) && (
        <section className="card">
          <h2>{item ? "Editar registro" : "Novo registro"}</h2>
          <form
            key={item?.id ?? "new"}
            action={saveCatalog}
            className="form-grid"
          >
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={item?.id ?? ""} />
            <label className="span-2">
              Nome / descrição
              <input
                name="name"
                defaultValue={item?.name ?? ""}
                required
                maxLength={fieldLimits.catalogName}
              />
            </label>
            {kind === "logistics" ? (
              <ClassificationFields
                editing={Boolean(item)}
                initial={
                  item?.data ?? {
                    area: p.area ?? "",
                    nature: p.nature ?? "",
                    type: p.type ?? "",
                  }
                }
                rows={classifications.map((c) => c.data)}
              />
            ) : (
              config.fields.map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    name={key}
                    defaultValue={item?.data[key] ?? ""}
                    maxLength={fieldLimits.catalogValue}
                    type={key === "link" ? "url" : "text"}
                  />
                </label>
              ))
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={item?.active ?? true}
              />
              Registro ativo
            </label>
            <div>
              <button>Salvar registro</button>
            </div>
          </form>
          {item && (
            <details>
              <summary>Excluir registro sem referências</summary>
              <form action={deleteSystemCatalog}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="kind" value={kind} />
                <label className="checkbox">
                  <input name="confirm" type="checkbox" required />
                  Confirmo a exclusão deste registro.
                </label>
                <button>Excluir registro</button>
              </form>
            </details>
          )}
        </section>
      )}
    </>
  );
}
