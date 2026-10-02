import "server-only";
import { z } from "zod";
import type { AuthorizationClient } from "./authorization";
import { catalogKinds } from "./domain";
import { ensureQuerySucceeded } from "./errors";
export async function catalogManagementScope(db: AuthorizationClient) {
  const result = await db.rpc("os_catalog_management_scope");
  ensureQuerySucceeded(result, "Falha ao verificar acesso aos cadastros");
  return z
    .object({
      areas: z.array(z.string()),
      kinds: z.array(z.enum(catalogKinds)),
    })
    .parse(result.data);
}
