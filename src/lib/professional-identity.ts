import "server-only";
import { z } from "zod";
import { fieldLimits } from "./application-config";
import {
  normalizeAreaName,
} from "./domain";
import {
  normalizeInstitutionalEmail,
} from "./professional-identity-core";
export * from "./professional-identity-core";

export const professionalMembershipSchema = z
  .object({
    id: z.union([z.literal(""), z.uuid()]),
    professional_id: z.union([z.literal(""), z.uuid()]),
    email: z.union([
      z.literal(""),
      z.email().max(fieldLimits.email).transform(normalizeInstitutionalEmail),
    ]),
    name: z.string().trim().min(1).max(fieldLimits.profileName),
    registration: z.string().trim().max(80),
    position: z.string().trim().max(160),
    role: z.enum(["admin", "gestor", "gestor_area", "solicitante", "responsavel"]),
    unit_id: z.union([z.literal(""), z.uuid()]),
    area: z.string().trim().max(500).transform(normalizeAreaName).default(""),
  })
  .superRefine((value, context) => {
    if (!value.professional_id && !value.email) {
      context.addIssue({
        code: "custom",
        path: ["email"],
        message: "E-mail institucional obrigatório",
      });
    }
    if (
      !value.unit_id &&
      (value.role === "solicitante" || value.role === "responsavel")
    ) {
      context.addIssue({
        code: "custom",
        path: ["unit_id"],
        message: "Unidade obrigatória para o papel",
      });
    }
    if (value.unit_id && value.role === "admin") {
      context.addIssue({
        code: "custom",
        path: ["unit_id"],
        message: "Administrador deve possuir escopo global",
      });
    }
    if (
      (value.role === "responsavel" || value.role === "gestor_area") &&
      !value.area
    ) {
      context.addIssue({
        code: "custom",
        path: ["area"],
        message: "Área obrigatória para este perfil",
      });
    }
    if (
      value.role !== "responsavel" &&
      value.role !== "gestor_area" &&
      value.area
    ) {
      context.addIssue({
        code: "custom",
        path: ["area"],
        message: "Área permitida somente para responsável ou gestor de área",
      });
    }
  });

export type ProfessionalMembershipInput = z.infer<
  typeof professionalMembershipSchema
>;
