import { z } from "zod";

export const pendingAcknowledgementsSchema = z.array(
  z.object({
    id: z.uuid(),
    os_id: z.uuid(),
    protocol: z.string(),
    title: z.string(),
    encaminhado_em: z.string(),
  }),
);
export type PendingAcknowledgement = z.infer<
  typeof pendingAcknowledgementsSchema
>[number];
export type AcknowledgementState =
  { ok: true; items: PendingAcknowledgement[] } | { ok: false; error: string };
