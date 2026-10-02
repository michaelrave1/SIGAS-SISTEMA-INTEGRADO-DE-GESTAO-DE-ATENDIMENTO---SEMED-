"use client";

import { useState } from "react";
import {
  addServiceEntry,
  acceptAssignment,
  completeOrder,
  resumeService,
  serviceOperation,
  startService,
} from "@/app/actions/orders";
import { ActionSubmitButton } from "@/components/action-submit-button";
import {
  isCompletionServiceType,
  availableServiceOptions,
  isServiceProgressAction,
  type ServiceActionPresentation,
} from "@/lib/service-actions";
import { workflowLimits } from "@/lib/domain";
import type { AvailableWorkflowAction } from "./types";

export function OrderServiceForm({
  id,
  version,
  actions,
  serviceEntryTypes,
  openIssues,
  actionPresentation = [],
}: {
  id: string;
  version: number;
  actions: AvailableWorkflowAction[];
  serviceEntryTypes: { key: string; name: string }[];
  openIssues: { id: number; description: string; operational_kind: string }[];
  actionPresentation?: ServiceActionPresentation[];
}) {
  const [selected, setSelected] = useState("");
  const options = availableServiceOptions(
    actions,
    openIssues.length,
    actionPresentation,
  );
  const selectedIsAvailable = options.some(([action]) => action === selected);
  const selectedAction = selectedIsAvailable ? selected : "";
  const isFormalEntry = selectedAction === "ADD_SERVICE_ENTRY";
  const isCompletion = selectedAction === "COMPLETE";
  const canComplete = actions.some(({ operation }) => operation === "COMPLETE");
  const isProgress = isServiceProgressAction(selectedAction);
  const progressAction =
    selectedAction === "ACCEPT_ASSIGNMENT"
      ? acceptAssignment
      : selectedAction === "START_SERVICE"
        ? startService
        : resumeService;
  const recordTypes = serviceEntryTypes.filter(
    (type) => !isCompletionServiceType(type.key, type.name),
  );

  if (!options.length) return null;

  return (
    <form
      action={
        isProgress
          ? progressAction
          : isCompletion
            ? completeOrder
            : isFormalEntry
              ? addServiceEntry
              : serviceOperation
      }
      className="form-grid service-entry-form"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <label className="span-2">
        Ação do atendimento
        <select
          name="service_action"
          required
          value={selectedAction}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Selecione a ação</option>
          {options.map(([action, label]) => (
            <option key={action} value={action}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {isProgress && (
        <p className="muted span-2">
          {selectedAction === "ACCEPT_ASSIGNMENT"
            ? "Confirme que você assumirá o atendimento desta OS."
            : selectedAction === "START_SERVICE"
              ? "Inicie o atendimento para liberar os registros técnicos e as demais ações permitidas."
              : "Retome o atendimento após o período de espera."}{" "}
          O profissional, a data e a hora serão registrados no histórico pelo
          sistema.
        </p>
      )}
      {!isCompletion && !isProgress && (
        <>
          <label>
            Tipo do registro
            <select
              name={isFormalEntry ? "entry_type" : "entry_kind"}
              required
              defaultValue=""
              disabled={!selectedAction}
            >
              <option value="">Selecione</option>
              {recordTypes.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data do atendimento
            <input
              name="serviced_at"
              type="datetime-local"
              required
              disabled={!selectedAction}
            />
          </label>
        </>
      )}
      {selectedAction === "RESOLVE" && (
        <label className="span-2">
          Registro a resolver
          <select name="related_entry" required defaultValue="">
            <option value="">Selecione</option>
            {openIssues.map((entry) => (
              <option key={entry.id} value={entry.id}>
                #{entry.id} — {entry.description}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedAction === "OPERATIONAL_UPDATE" && (
        <label>
          Possui material?
          <select name="material_status" required>
            <option>Não informado</option>
            <option>Sim</option>
            <option>Não</option>
          </select>
        </label>
      )}
      {!isProgress && (
        <label className="span-2">
          {isCompletion ? "Resumo do serviço executado" : "Descrição"}
          <textarea
            name={isCompletion ? "service_summary" : "description"}
            required
            minLength={workflowLimits.solutionMin}
            maxLength={
              isFormalEntry || isCompletion
                ? workflowLimits.solutionMax
                : workflowLimits.justificationMax
            }
            rows={4}
            disabled={!selectedAction}
          />
        </label>
      )}
      {isCompletion && (
        <>
          {!canComplete && (
            <p className="notice span-2" role="status">
              {openIssues.length > 0
                ? "Resolva as pendências e os impedimentos antes de encerrar a OS."
                : actions.some(
                      ({ operation }) =>
                        operation === "ACCEPT_ASSIGNMENT" ||
                        operation === "START_SERVICE" ||
                        operation === "RESUME",
                    )
                  ? "Assuma, inicie ou retome o atendimento antes de encerrar a OS."
                  : actions.some(
                        ({ operation }) => operation === "ADD_SERVICE_ENTRY",
                      )
                    ? "Adicione um registro de atendimento técnico antes de encerrar a OS. Se já houver um registro, verifique sua permissão de conclusão com o administrador."
                    : "O encerramento exige atendimento iniciado, um registro técnico, ausência de pendências e autorização para concluir a OS. O administrador pode verificar seu vínculo como responsável e sua permissão de conclusão."}
            </p>
          )}
          <label className="span-2">
            Solução / providência adotada
            <textarea
              name="solution"
              required
              minLength={workflowLimits.solutionMin}
              maxLength={workflowLimits.solutionMax}
              rows={4}
            />
          </label>
          <label className="span-2">
            Observações finais
            <textarea
              name="final_notes"
              maxLength={workflowLimits.solutionMax}
              rows={3}
            />
          </label>
          <p className="muted span-2">
            A confirmação registra o encerramento e conclui a OS. A data e a
            hora são registradas pelo sistema.
          </p>
        </>
      )}
      <div>
        <ActionSubmitButton
          disabled={!selectedAction || (isCompletion && !canComplete)}
        >
          {isProgress
            ? options.find(([action]) => action === selectedAction)?.[1]
            : isCompletion
              ? "Encerrar atendimento"
              : "Registrar atendimento"}
        </ActionSubmitButton>
      </div>
    </form>
  );
}
