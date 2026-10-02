"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { session } from "@/lib/session";
import { isCatalogKind } from "@/lib/domain";
import {
  actionFailed,
  formText,
  requireAdministrator,
  requireActionPermission,
} from "./shared";

const typesPath = "/administracao/cadastros/atendimentos";
export async function setCatalogActive(form: FormData) {
  const { db } = await session();
  const kind = formText(form, "kind");
  if (!isCatalogKind(kind)) throw new Error("Cadastro inválido");
  const path = `/cadastros/${kind}`;
  await requireActionPermission(
    db,
    `${kind}.update`,
    path,
    "set_catalog_active",
  );
  const target = z.uuid().safeParse(formText(form, "id"));
  if (!target.success) return actionFailed(path, "validation");
  const current = await db
    .from("os_catalogs")
    .select("name,data")
    .eq("id", target.data)
    .eq("kind", kind)
    .single();
  if (current.error) return actionFailed(path);
  const { error } = await db.rpc("os_save_catalog", {
    target: target.data,
    catalog_kind: kind,
    catalog_name: current.data.name,
    catalog_data: current.data.data,
    catalog_active: formText(form, "active") === "true",
  });
  if (error) return actionFailed(path);
  revalidatePath(path);
  revalidatePath("/ordens", "layout");
  redirect(path);
}
export async function saveServiceEntryType(form: FormData) {
  const { db, admin } = await session();
  requireAdministrator(admin);
  await requireActionPermission(
    db,
    "system_catalogs.manage",
    typesPath,
    "save_service_type",
  );
  const input = z
    .object({
      id: z.union([z.uuid(), z.literal("")]),
      name: z.string().trim().min(1).max(80),
      sort_order: z.coerce.number().int().min(0).max(9999),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return actionFailed(typesPath, "validation");
  const { error } = await db.rpc("os_save_service_entry_type", {
    target: input.data.id || null,
    type_name: input.data.name,
    type_active: form.get("active") === "on",
    type_order: input.data.sort_order,
  });
  if (error)
    return actionFailed(
      typesPath,
      error.code === "23505" ? "validation" : "unexpected",
    );
  revalidatePath(typesPath);
  revalidatePath("/ordens", "layout");
  redirect(typesPath);
}

export async function deleteSystemCatalog(form: FormData) {
  const { db, admin } = await session();
  const kind = formText(form, "kind");
  const isType = kind === "service_type";
  const isUnit = kind === "units";
  if (isType || isUnit) requireAdministrator(admin);
  if (!isType && !isUnit && !isCatalogKind(kind))
    throw new Error("Cadastro inválido");
  const path = isType ? typesPath : isUnit ? "/unidades" : `/cadastros/${kind}`;
  await requireActionPermission(
    db,
    isType
      ? "system_catalogs.manage"
      : isUnit
        ? "units.update"
        : `${kind as "logistics" | "routes" | "vehicles" | "drivers"}.update`,
    path,
    "delete_catalog",
  );
  const target = z.uuid().safeParse(formText(form, "id"));
  if (!target.success || form.get("confirm") !== "on")
    return actionFailed(path, "validation");
  const { error } = await db.rpc(
    isType
      ? "os_delete_service_entry_type"
      : isUnit
        ? "os_delete_unit"
        : "os_delete_catalog",
    { target: target.data },
  );
  if (error)
    redirect(
      `${path}?erro=${error.code === "23503" ? "referenced" : "unexpected"}`,
    );
  revalidatePath(path);
  revalidatePath("/ordens", "layout");
  redirect(path);
}
