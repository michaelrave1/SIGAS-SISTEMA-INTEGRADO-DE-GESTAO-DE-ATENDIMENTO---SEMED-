import { ActionSubmitButton } from "@/components/action-submit-button";
import { addServiceEntry, serviceOperation } from "@/app/actions/orders";
import { date } from "@/components/ui";
import { workflowLimits } from "@/lib/domain";
import type { AvailableWorkflowAction, OrderServiceEntryView } from "./types";

const operationalActions = [
  ["IMPEDIMENT", "Registrar impedimento"],
  ["PENDING", "Registrar pendência"],
  ["RESOLVE", "Resolver pendência ou impedimento"],
  ["REQUEST_INFORMATION", "Solicitar informação ao solicitante"],
  ["REQUEST_FORWARDING", "Solicitar reencaminhamento ao gestor da área"],
  ["OPERATIONAL_UPDATE", "Atualizar informações operacionais"],
  ["RETURN_TRIAGE", "Devolver à triagem"],
] as const;

export function OrderService({
  id,
  version,
  entries,
  canAdd,
  serviceEntryTypes,
  actions,
  openIssues,
}: {
  id: string;
  version: number;
  entries: OrderServiceEntryView[];
  canAdd: boolean;
  serviceEntryTypes: { key: string; name: string }[];
  actions: AvailableWorkflowAction[];
  openIssues: { id: number; description: string; operational_kind: string }[];
}) {
  const allowed = new Set(actions.map(action => action.operation as string));
  const unresolved = openIssues;
  const operations = operationalActions.filter(([action]) => allowed.has(action) && (action !== "RESOLVE" || unresolved.length > 0));
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
      {operations.map(([action, label]) => (
        <details className="workflow-action" key={action}>
          <summary>{label}</summary>
          <form action={serviceOperation} className="form-grid">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={version} />
            <input type="hidden" name="service_action" value={action} />
            <label>Tipo do registro<select name="entry_kind" required defaultValue="">
              <option value="">Selecione</option>
              {serviceEntryTypes.map(type => <option key={type.key} value={type.key}>{type.name}</option>)}
            </select></label>
            {action === "RESOLVE" && <label>Registro a resolver<select name="related_entry" required defaultValue="">
              <option value="">Selecione</option>
              {unresolved.map(entry => <option key={entry.id} value={entry.id}>#{entry.id} — {entry.description}</option>)}
            </select></label>}
            {action === "OPERATIONAL_UPDATE" && <label>Possui material?<select name="material_status" required>
              <option>Não informado</option><option>Sim</option><option>Não</option>
            </select></label>}
            <label className="span-2">{action === "REQUEST_INFORMATION" ? "Informação solicitada" : "Descrição / justificativa"}
              <textarea name="description" required minLength={3} maxLength={2000} rows={4} />
            </label>
            <ActionSubmitButton>{label}</ActionSubmitButton>
          </form>
        </details>
      ))}
      {unresolved.length > 0 && <p role="status">Há {unresolved.length} pendência(s) ou impedimento(s) a resolver antes da conclusão.</p>}
      {canAdd && (
        <details className="workflow-action service-entry-form">
          <summary>Adicionar registro de atendimento</summary>
          <form action={addServiceEntry} className="form-grid">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={version} />
            <label>
              Tipo do registro
              <select name="entry_type" required defaultValue="">
                <option value="">Selecione</option>
                {serviceEntryTypes.map((entryType) => (
                  <option key={entryType.key} value={entryType.key}>
                    {entryType.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Data do atendimento
              <input name="serviced_at" type="datetime-local" required />
            </label>
            <label className="span-2">
              Descrição
              <textarea
                name="description"
                required
                minLength={workflowLimits.solutionMin}
                maxLength={workflowLimits.solutionMax}
                rows={4}
              />
            </label>
            <div>
              <ActionSubmitButton>Registrar atendimento</ActionSubmitButton>
            </div>
          </form>
        </details>
      )}
      <div className="timeline service-timeline">
        {entries.map((entry) => (
          <article key={entry.id}>
            <strong>{entry.entry_type_name ?? entry.entry_type}</strong>
            {entry.operational_kind && <small>{operationalActions.find(([action]) => action.toLowerCase() === entry.operational_kind)?.[1] ?? entry.operational_kind} · #{entry.id}</small>}
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
