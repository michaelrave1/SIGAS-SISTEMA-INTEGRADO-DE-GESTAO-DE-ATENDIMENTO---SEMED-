"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { session } from "@/lib/session";
import {
  pendingAcknowledgementsSchema,
  type AcknowledgementState,
} from "@/lib/order-acknowledgements";
import { logServerEvent } from "@/lib/observability";

export async function pendingAcknowledgements(): Promise<AcknowledgementState> {
  const { db } = await session();
  try {
    let { data, error } = await db.rpc("os_pending_all_acknowledgements");
    // Durante a implantação, preservar o bloqueio de encaminhamentos existente.
    if (error && ["42883", "PGRST202"].includes(error.code)) {
      const legacy = await db.rpc("os_pending_acknowledgements");
      data = legacy.data;
      error = legacy.error;
    }
    if (error) throw new Error("pending_query_failed");
    return { ok: true, items: pendingAcknowledgementsSchema.parse(data) };
  } catch {
    logServerEvent("warn", "acknowledgements_query_failed", {
      operation: "list_acknowledgements",
    });
    return {
      ok: false,
      error:
        "Não foi possível consultar as ciências pendentes. Tente novamente.",
    };
  }
}

export async function acknowledgeMessage(
  id: string,
): Promise<AcknowledgementState> {
  const { db } = await session();
  if (!z.uuid().safeParse(id).success)
    return { ok: false, error: "Mensagem inválida. Atualize a lista." };
  try {
    const { error } = await db.rpc("os_acknowledge_message", { target: id });
    if (error) {
      logServerEvent("warn", "message_acknowledgement_rejected", {
        operation: "acknowledge_message",
        status: error.code,
      });
      return {
        ok: false,
        error:
          error.code === "42501"
            ? "Você não tem autorização para dar ciência nesta mensagem. Atualize a lista."
            : "Não foi possível registrar a ciência da mensagem. Tente novamente.",
      };
    }
    revalidatePath("/ordens", "layout");
    return pendingAcknowledgements();
  } catch {
    return {
      ok: false,
      error:
        "Falha de comunicação. Confirmações já gravadas serão preservadas. Tente novamente.",
    };
  }
}

export async function acknowledgeDispatch(
  id: string,
): Promise<AcknowledgementState> {
  const { db } = await session();
  if (!z.uuid().safeParse(id).success)
    return { ok: false, error: "Encaminhamento inválido. Atualize a lista." };
  try {
    const { error } = await db.rpc("os_acknowledge_dispatch", { target: id });
    // Encerramento concorrente: consultar novamente remove a pendência sem inventar ciência.
    if (error && error.code !== "55000") {
      logServerEvent("warn", "acknowledgement_rejected", {
        operation: "acknowledge_dispatch",
        status: error.code,
      });
      return {
        ok: false,
        error:
          error.code === "42501"
            ? "Você não tem autorização para dar ciência neste encaminhamento. Atualize a lista."
            : "Não foi possível registrar a ciência. Tente novamente; confirmações já gravadas serão preservadas.",
      };
    }
    revalidatePath("/ordens", "layout");
    return pendingAcknowledgements();
  } catch {
    return {
      ok: false,
      error:
        "Falha de comunicação. Tente novamente; confirmações já gravadas serão preservadas.",
    };
  }
}
