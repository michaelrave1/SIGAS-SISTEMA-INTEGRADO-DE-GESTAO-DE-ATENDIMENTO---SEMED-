export const serviceActionOptions = [
  ["ACCEPT_ASSIGNMENT", "Assumir atendimento"],
  ["START_SERVICE", "Iniciar atendimento"],
  ["RESUME", "Retomar atendimento"],
  ["IMPEDIMENT", "Registrar impedimento"],
  ["PENDING", "Registrar pendência"],
  ["REQUEST_INFORMATION", "Solicitar informação ao solicitante"],
  ["REQUEST_FORWARDING", "Solicitar reencaminhamento ao gestor da área"],
  ["OPERATIONAL_UPDATE", "Atualizar informações operacionais"],
  ["RETURN_TRIAGE", "Devolver à triagem"],
  ["ADD_SERVICE_ENTRY", "Adicionar registro de atendimento"],
  ["COMPLETE", "Encerramento do atendimento"],
  ["RESOLVE", "Resolver pendência ou impedimento"],
] as const;

export type ServiceAction = (typeof serviceActionOptions)[number][0];

export function availableServiceOptions(
  actions: readonly { operation: string }[],
  openIssueCount: number,
) {
  const allowed = new Set(actions.map(({ operation }) => operation));
  return serviceActionOptions.filter(
    ([action]) =>
      allowed.has(action) && (action !== "RESOLVE" || openIssueCount > 0),
  );
}

export function isServiceProgressAction(action: string) {
  return ["ACCEPT_ASSIGNMENT", "START_SERVICE", "RESUME"].includes(action);
}

export function isCompletionServiceType(key: string, name: string) {
  const completionNames = new Set([
    "encerrar atendimento",
    "encerrar o atendimento",
    "encerramento do atendimento",
    "encerramento de atendimento",
    "encerramento atendimento",
  ]);
  return [key, name].some((value) =>
    completionNames.has(
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, " "),
    ),
  );
}
