export const orderTimelineEventLabels: Readonly<Record<string, string>> = {
  service_impediment: "Impedimento",
  service_pending: "Pendência",
  service_issue_resolved: "Resolução de pendência",
  information_requested: "Solicitação de informação",
  forwarding_requested: "Solicitação de reencaminhamento",
  order_returned_triage: "Devolução à triagem",
  operational_information_updated: "Informações operacionais",
  service_completion_report: "Relatório de conclusão",
  wait_period_closed: "Período de espera",
  message_added: "Mensagem",
  message_acknowledged: "Ciência da mensagem",
  order_opened: "Abertura",
  order_reconciled: "Conciliação",
  triage_started: "Início da triagem",
  category_changed: "Alteração de categoria",
  priority_changed: "Alteração de prioridade",
  order_forwarded: "Encaminhamento",
  order_acknowledged: "Ciência do encaminhamento",
  order_assigned: "Atribuição",
  order_reassigned: "Reatribuição",
  service_started: "Início do atendimento",
  service_entry_added: "Registro de atendimento",
  information_wait_started: "Início da espera",
  service_resumed: "Retomada",
  order_completed: "Conclusão",
  order_canceled: "Cancelamento",
  order_reopened: "Reabertura",
  order_edited: "Edição controlada",
  attachment_added: "Anexo adicionado",
  service_attachment_added: "Anexo do atendimento adicionado",
  workflow_backfill: "Adequação ao novo fluxo",
};

export function orderTimelineEventLabel(
  eventType: string | null,
  fromStatus: string | null,
) {
  if (eventType) return orderTimelineEventLabels[eventType] ?? "Evento da ordem";
  return fromStatus ? "Alteração de situação" : "Abertura";
}

export function orderTimelineTransition(
  fromStatus: string | null,
  toStatus: string,
) {
  if (!fromStatus || fromStatus === toStatus) return null;
  return `${fromStatus} → ${toStatus}`;
}
