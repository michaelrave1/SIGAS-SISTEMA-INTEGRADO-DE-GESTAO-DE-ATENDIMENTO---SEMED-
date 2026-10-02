export const serviceActionOptions = [
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
