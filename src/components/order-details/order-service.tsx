import { date } from "@/components/ui";
import {
  availableServiceOptions,
  serviceActionOptions,
  type ServiceActionPresentation,
} from "@/lib/service-actions";
import { OrderServiceForm } from "./order-service-form";
import type { AvailableWorkflowAction, OrderServiceEntryView } from "./types";

export function OrderService({
  id,
  version,
  entries,
  canAdd,
  serviceEntryTypes,
  actions,
  openIssues,
  actionPresentation = [],
}: {
  id: string;
  version: number;
  entries: OrderServiceEntryView[];
  canAdd: boolean;
  serviceEntryTypes: { key: string; name: string }[];
  actions: AvailableWorkflowAction[];
  openIssues: { id: number; description: string; operational_kind: string }[];
  actionPresentation?: ServiceActionPresentation[];
}) {
  const unresolved = openIssues;
  const operations = availableServiceOptions(
    actions,
    unresolved.length,
    actionPresentation,
  );
  if (!canAdd && !entries.length && !operations.length) return null;

  return (
    <section className="card service-records">
      <div className="section-head">
        <div>
          <p className="eyebrow">ATENDIMENTO</p>
          <h2>Registro formal de atendimento</h2>
          <p className="muted">
            Evidências técnicas do serviço executado, separadas das mensagens da
            ordem.
          </p>
        </div>
      </div>
      <OrderServiceForm
        id={id}
        version={version}
        actions={actions}
        serviceEntryTypes={serviceEntryTypes}
        openIssues={openIssues}
        actionPresentation={actionPresentation}
      />
      {unresolved.length > 0 && (
        <p role="status">
          Há {unresolved.length} pendência(s) ou impedimento(s) a resolver antes
          da conclusão.
        </p>
      )}
      <div className="timeline service-timeline">
        {entries.map((entry) => (
          <article key={entry.id}>
            <strong>{entry.entry_type_name ?? entry.entry_type}</strong>
            {entry.operational_kind && (
              <small>
                {serviceActionOptions.find(
                  ([action]) => action.toLowerCase() === entry.operational_kind,
                )?.[1] ?? entry.operational_kind}{" "}
                · #{entry.id}
              </small>
            )}
            <small>Atendimento em {date(entry.serviced_at)}</small>
            <p>{entry.description}</p>
          </article>
        ))}
        {!entries.length && (
          <p className="empty">Nenhum atendimento formal registrado.</p>
        )}
      </div>
    </section>
  );
}
