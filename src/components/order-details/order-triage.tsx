import { assignOrder, reassignOrder, startTriage } from "@/app/actions";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { workflowActionNames, workflowLimits } from "@/lib/domain";
import type {
  AvailableWorkflowAction,
  ResponsibleMembershipOption,
} from "./types";

export function OrderTriage({
  id,
  version,
  actions,
  responsibleMemberships,
}: {
  id: string;
  version: number;
  actions: AvailableWorkflowAction[];
  responsibleMemberships: ResponsibleMembershipOption[];
}) {
  const available = new Set(actions.map(({ operation }) => operation));
  const canTriage = available.has(workflowActionNames.triage);
  const canAssign = available.has(workflowActionNames.assign);
  const canReassign = available.has(workflowActionNames.reassign);
  if (!canTriage && !canAssign && !canReassign) return null;
  const fields = (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
    </>
  );
  return (
    <section className="card workflow-actions-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">GESTÃO DA ÁREA</p>
          <h2>Triagem e encaminhamento</h2>
          <p className="muted">
            Confira as informações da OS e encaminhe o atendimento a um
            responsável da mesma área. Ordens devolvidas à triagem podem ser
            encaminhadas novamente.
          </p>
        </div>
      </div>
      {canTriage && (
        <form action={startTriage}>
          {fields}
          <ActionSubmitButton>Iniciar triagem</ActionSubmitButton>
        </form>
      )}
      {(canAssign || canReassign) && (
        <form
          action={canAssign ? assignOrder : reassignOrder}
          className="form-grid"
        >
          {fields}
          <label>
            Profissional responsável pelo atendimento
            <select
              name="responsible_membership_id"
              required
              defaultValue=""
              disabled={!responsibleMemberships.length}
            >
              <option value="">Selecione</option>
              {responsibleMemberships.map((membership) => (
                <option key={membership.id} value={membership.id}>
                  {membership.name}
                </option>
              ))}
            </select>
          </label>
          {!canAssign && (
            <label>
              Justificativa do reencaminhamento
              <textarea
                name="justification"
                required
                minLength={workflowLimits.justificationMin}
                maxLength={workflowLimits.justificationMax}
              />
            </label>
          )}
          {!responsibleMemberships.length && (
            <p className="muted">
              Não há profissionais responsáveis ativos vinculados a esta área.
              Solicite ao administrador a atualização dos vínculos.
            </p>
          )}
          <div>
            <ActionSubmitButton
              disabled={!responsibleMemberships.length}
              pendingLabel="Encaminhando..."
            >
              {canAssign
                ? "Encaminhar ao profissional"
                : "Reencaminhar ao profissional"}
            </ActionSubmitButton>
          </div>
        </form>
      )}
    </section>
  );
}
