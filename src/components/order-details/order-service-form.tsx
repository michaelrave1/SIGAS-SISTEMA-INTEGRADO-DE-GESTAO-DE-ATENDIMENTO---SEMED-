"use client";

import { useState } from "react";
import { addServiceEntry, serviceOperation } from "@/app/actions/orders";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { serviceActionOptions } from "@/lib/service-actions";
import { workflowLimits } from "@/lib/domain";
import type { AvailableWorkflowAction } from "./types";

export function OrderServiceForm({
  id,
  version,
  actions,
  serviceEntryTypes,
  openIssues,
}: {
  id: string;
  version: number;
  actions: AvailableWorkflowAction[];
  serviceEntryTypes: { key: string; name: string }[];
  openIssues: { id: number; description: string; operational_kind: string }[];
}) {
  const [selected, setSelected] = useState("");
  const allowed = new Set(actions.map((action) => action.operation));
  const options = serviceActionOptions.filter(
    ([action]) =>
      allowed.has(action) && (action !== "RESOLVE" || openIssues.length > 0),
  );
  const selectedIsAvailable = options.some(([action]) => action === selected);
  const selectedAction = selectedIsAvailable ? selected : "";
  const isFormalEntry = selectedAction === "ADD_SERVICE_ENTRY";

  if (!options.length) return null;

  return (
    <form
      action={isFormalEntry ? addServiceEntry : serviceOperation}
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
      <label>
        Tipo do registro
        <select
          name={isFormalEntry ? "entry_type" : "entry_kind"}
          required
          defaultValue=""
          disabled={!selectedAction}
        >
          <option value="">Selecione</option>
          {serviceEntryTypes.map((type) => (
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
      <label className="span-2">
        Descrição
        <textarea
          name="description"
          required
          minLength={workflowLimits.solutionMin}
          maxLength={
            isFormalEntry
              ? workflowLimits.solutionMax
              : workflowLimits.justificationMax
          }
          rows={4}
          disabled={!selectedAction}
        />
      </label>
      <div>
        <ActionSubmitButton disabled={!selectedAction}>
          Registrar atendimento
        </ActionSubmitButton>
      </div>
    </form>
  );
}
