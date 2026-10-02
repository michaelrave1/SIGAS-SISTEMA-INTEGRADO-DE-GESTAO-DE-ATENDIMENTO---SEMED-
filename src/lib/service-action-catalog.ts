import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { ensureQuerySucceeded } from "./errors";

export async function loadServiceActionCatalog(db: SupabaseClient<Database>) {
  const result = await db.rpc("os_service_action_catalog");
  // Compatibilidade até a aplicação da nova migration, sem alterar o workflow.
  if (result.error && ["42883", "PGRST202"].includes(result.error.code))
    return { available: false, rows: [] };
  ensureQuerySucceeded(result, "Falha ao consultar ações de atendimento");
  return { available: true, rows: result.data ?? [] };
}
