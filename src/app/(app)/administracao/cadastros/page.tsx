import Link from "next/link";
import { redirect } from "next/navigation";
import { Heading } from "@/components/ui";
import { session } from "@/lib/session";
import { getUserPermissions, requirePagePermission } from "@/lib/authorization";

export default async function SystemCatalogs() {
  const { db, admin } = await session();
  if (!admin) redirect("/sem-acesso");
  await requirePagePermission("system_catalogs.manage", db);
  const permissions = await getUserPermissions(db);
  return (
    <>
      <Heading
        title="Cadastros do Sistema"
        description="Administre os cadastros utilizados nas solicitações e nos atendimentos."
      />
      {permissions.has("logistics.view") && (
        <section className="card">
          <h2>Classificações das Solicitações</h2>
          <p>
            Área → Natureza → Tipo → Descrição / Detalhamento. Cada
            classificação mantém a combinação completa no cadastro existente.
          </p>
          <ul>
            {[
              ["area", "Áreas"],
              ["nature", "Naturezas por Área"],
              ["type", "Tipos por Natureza"],
              ["detail", "Descrições e Detalhamentos"],
            ].map(([level, label]) => (
              <li key={level}>
                <Link href={`/cadastros/logistics?level=${level}`}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card">
        <h2>Unidades e Profissionais</h2>
        <ul>
          {permissions.has("units.view") && (
            <li>
              <Link href="/unidades">Unidades</Link>
            </li>
          )}
          {permissions.has("professionals.view") && (
            <li>
              <Link href="/usuarios">Profissionais e Vínculos</Link>
            </li>
          )}
        </ul>
      </section>
      <section className="card">
        <h2>Transporte Escolar</h2>
        <ul>
          {permissions.has("drivers.view") && (
            <li>
              <Link href="/cadastros/drivers">Motoristas</Link>
            </li>
          )}
          {permissions.has("vehicles.view") && (
            <li>
              <Link href="/cadastros/vehicles">Veículos</Link>
            </li>
          )}
          {permissions.has("routes.view") && (
            <li>
              <Link href="/cadastros/routes">Rotas</Link>
            </li>
          )}
        </ul>
      </section>
      <section className="card">
        <h2>Registro formal de atendimento</h2>
        <p>
          Administre os tipos utilizados no registro formal de atendimento das
          ordens de serviço, sua ordem de exibição e sua situação.
        </p>
        <ul>
          <li>
            <Link href="/administracao/cadastros/atendimentos">
              Tipos de Registro de Atendimento
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}
