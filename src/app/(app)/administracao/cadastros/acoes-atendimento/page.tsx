import { redirect } from "next/navigation";
import { session } from "@/lib/session";
import { requirePagePermission } from "@/lib/authorization";
import { loadServiceActionCatalog } from "@/lib/service-action-catalog";
import { Heading, Notice } from "@/components/ui";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { saveServiceActionSetting } from "@/app/actions/system-catalogs";

export default async function ServiceActions({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { db, admin } = await session();
  if (!admin) redirect("/sem-acesso");
  await requirePagePermission("system_catalogs.manage", db);
  const query = await searchParams;
  const catalog = await loadServiceActionCatalog(db);
  return (
    <>
      <Heading
        title="Ações de atendimento"
        description="Edite os nomes e a ordem das ações exibidas no atendimento das OS. As regras do fluxo, as permissões e o histórico são preservados."
      />
      <Notice error={query.erro} />
      {!catalog.available && (
        <p className="notice" role="status">
          Este cadastro depende da atualização do banco preparada para esta
          funcionalidade. As ações atuais de atendimento continuam disponíveis.
        </p>
      )}
      {catalog.rows.map((row) => (
        <section className="card" key={row.operation}>
          <h2>{row.name}</h2>
          <p className="muted">
            Estados permitidos: {row.states.join(", ")}. A execução continua
            sujeita ao vínculo do profissional, à ciência e às demais validações
            da OS.
          </p>
          <form
            action={saveServiceActionSetting}
            className="form-grid"
            key={`${row.operation}:${row.name}:${row.sort_order}`}
          >
            <input type="hidden" name="operation" value={row.operation} />
            <label>
              Nome da ação
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={row.name}
              />
            </label>
            <label>
              Ordem de exibição
              <input
                name="sort_order"
                type="number"
                required
                min={0}
                max={9999}
                defaultValue={row.sort_order}
              />
            </label>
            <div>
              <ActionSubmitButton>Salvar</ActionSubmitButton>
            </div>
          </form>
        </section>
      ))}
    </>
  );
}
