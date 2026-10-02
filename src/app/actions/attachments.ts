"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { session } from "@/lib/session";
import {
  attachmentBucket,
  attachmentContentMatches,
  attachmentExtensionMatches,
  isAttachmentMimeType,
  attachmentSha256,
  normalizeAttachmentName,
} from "@/lib/attachments";
import { actionFailed, formText, requireActionPermission } from "./shared";
import { orderActionPermissions } from "@/lib/authorization-policy";

export async function uploadAttachment(form: FormData) {
  const { db } = await session();
  const orderId = z.uuid().parse(formText(form, "id"));
  await requireActionPermission(
    db,
    orderActionPermissions.UPLOAD_ATTACHMENT,
    `/ordens/${orderId}`,
    "UPLOAD_ATTACHMENT",
  );
  const file = form.get("file");
  const { data: policies, error: policyError } = await db.rpc("os_attachment_policy");
  const policy = policies?.[0];
  if (
    !(file instanceof File) || policyError || !policy || file.size < 1 ||
    file.size > Number(policy.max_file_bytes) ||
    !policy.allowed_mimes.includes(file.type) ||
    !isAttachmentMimeType(file.type)
  ) return actionFailed(`/ordens/${orderId}`);
  const name = normalizeAttachmentName(file.name);
  if (!name || !attachmentExtensionMatches(name, file.type) ||
      !(await attachmentContentMatches(file))) return actionFailed(`/ordens/${orderId}`);
  const submission = z.uuid().safeParse(form.get("request_id"));
  if (!submission.success) return actionFailed(`/ordens/${orderId}`);
  const id = submission.data;
  const sha256 = await attachmentSha256(file);
  const { data: path, error: reserveError } = await db.rpc(
    "os_begin_attachment_upload",
    {
      target_order: orderId,
      attachment_id: id,
      original_name: name,
      declared_mime: file.type,
      declared_size: file.size,
      sha256,
    },
  );
  if (reserveError || !path) return actionFailed(`/ordens/${orderId}`);
  const { data: existing } = await db.from("os_attachments").select("storage_status").eq("id", id).single();
  if (existing?.storage_status === "ready") {
    revalidatePath(`/ordens/${orderId}`);
    return;
  }
  const { error: uploadError } = await db.storage
    .from(attachmentBucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    // Uma requisição concorrente pode ter concluído o mesmo envio.
    const { data: completed } = await db.rpc("os_complete_attachment_upload", { target: id });
    if (completed === "ready") {
      revalidatePath(`/ordens/${orderId}`);
      return;
    }
    await db.rpc("os_abort_attachment_upload", { target: id });
    return actionFailed(`/ordens/${orderId}`);
  }
  const { data: completion, error: completionError } = await db.rpc(
    "os_complete_attachment_upload",
    { target: id },
  );
  if (completionError || completion !== "ready") return actionFailed(`/ordens/${orderId}`);
  revalidatePath(`/ordens/${orderId}`);
}
