export const serviceActionOptions = [
  ["IMPEDIMENT", "Registrar impedimento"],
  ["PENDING", "Registrar pendência"],
  ["REQUEST_INFORMATION", "Solicitar informação ao solicitante"],
  ["REQUEST_FORWARDING", "Solicitar reencaminhamento ao gestor da área"],
  ["OPERATIONAL_UPDATE", "Atualizar informações operacionais"],
  ["RETURN_TRIAGE", "Devolver à triagem"],
  ["ADD_SERVICE_ENTRY", "Adicionar registro de atendimento"],
  ["RESOLVE", "Resolver pendência ou impedimento"],
] as const;

export type ServiceAction = (typeof serviceActionOptions)[number][0];
