import { date } from "@/components/ui";
import type { OrderDetails } from "@/lib/domain";
import type { OrderCatalog, OrderDetail } from "./types";

const detailLabels = {
  observation: "Observações",
  occurred_at: "Data do ocorrido",
  has_material: "Material",
  police_report: "B.O. / REDS",
  operational_observation: "Observações operacionais",
} satisfies Partial<Record<keyof OrderDetails, string>>;

function isInformed(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const normalized = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  return !/^nao informad[oa]s?$/.test(normalized);
}

export function OrderSummary({
  order,
  catalogs,
}: {
  order: OrderDetail;
  catalogs: OrderCatalog[];
}) {
  const catalogName = (value: string) =>
    catalogs.find((catalog) => catalog.id === value)?.name ?? value;
  return (
    <section className="card">
      <div className="section-head">
        <div>
          <p className="eyebrow">SOLICITAÇÃO</p>
          <h2>Dados informados</h2>
        </div>
      </div>
      <dl className="details">
        {isInformed(order.opened_at) && (
          <>
            <dt>Abertura</dt>
            <dd>{date(order.opened_at)}</dd>
          </>
        )}
        {isInformed(order.driver_id) && (
          <>
            <dt>Motorista</dt>
            <dd>{catalogName(order.driver_id)}</dd>
          </>
        )}
        {isInformed(order.vehicle_id) && (
          <>
            <dt>Veículo</dt>
            <dd>{catalogName(order.vehicle_id)}</dd>
          </>
        )}
        {isInformed(order.route_id) && (
          <>
            <dt>Rota</dt>
            <dd>{catalogName(order.route_id)}</dd>
          </>
        )}
        {isInformed(order.resolution) && (
          <>
            <dt>Solução aplicada</dt>
            <dd>{order.resolution}</dd>
          </>
        )}
        {isInformed(order.service_summary) && (
          <>
            <dt>Resumo do serviço executado</dt>
            <dd>{order.service_summary}</dd>
          </>
        )}
        {isInformed(order.final_observations) && (
          <>
            <dt>Observações finais</dt>
            <dd>{order.final_observations}</dd>
          </>
        )}
        {Object.entries(order.details)
          .filter(([, value]) => isInformed(value))
          .map(([key, value]) => (
            <div key={key}>
              <dt>{detailLabels[key as keyof typeof detailLabels] ?? key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
