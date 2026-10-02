import type { ActionErrorCode } from "./action-result";

export function classifyProfessionalError(error: {
  code?: string;
  message?: string;
}): ActionErrorCode {
  const message = error.message ?? "";
  if (error.code === "42501" || message.includes("Acesso negado"))
    return "forbidden";
  if (message.includes("referenciado por ordem"))
    return "professional_order_link";
  if (message.includes("Perfil de acesso")) return "professional_configuration";
  if (
    message.includes("Área obrigatória") ||
    message.includes("Área inválida") ||
    message.includes("Unidade obrigatória")
  )
    return "validation";
  if (
    error.code === "23505" ||
    message.includes("referenciado por ordem") ||
    message.includes("próprio papel administrativo") ||
    message.includes("alteração de identidade")
  )
    return "professional_conflict";
  return "unexpected";
}
