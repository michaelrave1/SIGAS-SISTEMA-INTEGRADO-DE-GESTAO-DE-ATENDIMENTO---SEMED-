import { z } from "zod";

export const pendingAcknowledgementsSchema = z.array(
  z
    .object({
      id: z.uuid(),
      os_id: z.uuid(),
      protocol: z.string(),
      title: z.string(),
      encaminhado_em: z.string(),
      kind: z.enum(["dispatch", "message"]).default("dispatch"),
      body: z.string().optional(),
      author_name: z.string().optional(),
    })
    .superRefine((item, context) => {
      if (item.kind === "message" && item.body === undefined)
        context.addIssue({
          code: "custom",
          path: ["body"],
          message: "Mensagem indisponível",
        });
    }),
);
export type PendingAcknowledgement = z.infer<
  typeof pendingAcknowledgementsSchema
>[number];
export type AcknowledgementState =
  { ok: true; items: PendingAcknowledgement[] } | { ok: false; error: string };
