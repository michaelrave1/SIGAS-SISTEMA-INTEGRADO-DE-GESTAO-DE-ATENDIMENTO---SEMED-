import { notFound } from "next/navigation";
import { OrderDelete } from "@/components/order-details/order-delete";
import { z } from "zod";
import { Notice } from "@/components/ui";
import { OrderActivity } from "@/components/order-details/order-activity";
import { OrderAttachments } from "@/components/order-details/order-attachments";
import { OrderSummary } from "@/components/order-details/order-summary";
import { OrderHeader } from "@/components/order-details/order-header";
import { OrderCycle } from "@/components/order-details/order-cycle";
import { OrderService } from "@/components/order-details/order-service";
import { OrderTimeline } from "@/components/order-details/order-timeline";
import { OrderTriage } from "@/components/order-details/order-triage";
import { loadServiceActionCatalog } from "@/lib/service-action-catalog";
import { queryLimits } from "@/lib/application-config";
import { workflowActionNames } from "@/lib/domain";
import { session } from "@/lib/session";
import { ensureQueriesSucceeded, ensureQuerySucceeded } from "@/lib/errors";
import { pageNumber, pageRange } from "@/lib/pagination";
import type {
  OrderCatalog,
  OrderDetail,
} from "@/components/order-details/types";
import { requirePagePermission } from "@/lib/authorization";
import { routePermissions } from "@/lib/authorization-policy";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; page?: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const timelinePage = pageNumber(query.page);
  const timelineRange = pageRange(timelinePage);

  const { db, admin, user } = await session();
  await requirePagePermission(routePermissions.orders, db);
  const { data, error } = await db
    .from("os_orders")
    .select(
      "id,protocol,protocol_year,protocol_code,version,title,status,priority,resolution,service_summary,final_observations,unit_id,destination_unit_id,opened_by,responsible_id,category_id,driver_id,vehicle_id,route_id,details,opened_at,resume_status,waiting_reason,waiting_details",
    )
    .eq("id", id)
    .maybeSingle();
  ensureQuerySucceeded({ error }, "Falha ao consultar ordem");
  if (!data) notFound();

  const serviceTypes = await db
    .from("os_service_entry_types")
    .select("key,name")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  ensureQuerySucceeded(serviceTypes, "Falha ao consultar tipos de atendimento");
  const order = data as OrderDetail;
  const [
    messages,
    attachments,
    catalogs,
    timeline,
    serviceEntries,
    availableActions,
    attachmentPolicies,
    collaboration,
    orderHeader,
    actionCatalog,
  ] = await Promise.all([
    db
      .from("os_messages")
      .select("id,body,created_at,author_id")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(queryLimits.detailRows),
    db
      .from("os_attachments")
      .select("id,name,size_bytes")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(queryLimits.detailRows),
    db
      .from("os_catalogs")
      .select("id,kind,name,data")
      .eq("active", true)
      .order("name")
      .limit(queryLimits.lookupRows),
    db.rpc("os_order_timeline", {
      target: id,
      page_size: queryLimits.pageSize,
      page_offset: timelineRange.from,
    }),
    db
      .from("os_order_service_entries")
      .select(
        "id,entry_type,entry_type_name,description,serviced_at,created_at,operational_kind,related_entry_id",
      )
      .eq("order_id", id)
      .order("serviced_at", { ascending: false })
      .limit(queryLimits.detailRows),
    db.rpc("os_order_available_actions", { target: id }),
    db.rpc("os_attachment_policy"),
    db.rpc("os_order_can_collaborate", { target: id }),
    db.rpc("os_order_header", { target: id }),
    loadServiceActionCatalog(db),
  ]);

  ensureQueriesSucceeded(
    [
      messages,
      attachments,
      catalogs,
      timeline,
      serviceEntries,
      availableActions,
      attachmentPolicies,
      collaboration,
      orderHeader,
    ],
    "Falha ao consultar detalhes",
  );

  const canPost = collaboration.data === true;
  const catalogRows = (catalogs.data ?? []) as OrderCatalog[];
  const workflowOperations = availableActions.data ?? [];
  const canForward = workflowOperations.some(
    ({ operation }) =>
      operation === workflowActionNames.assign ||
      operation === workflowActionNames.reassign,
  );
  const responsibleOptions = canForward
    ? await db.rpc("os_order_responsible_options", { target: id })
    : { data: [], error: null };
  ensureQuerySucceeded(
    responsibleOptions,
    "Falha ao consultar responsáveis da área",
  );
  const openIssues = await db.rpc("os_order_open_service_issues", {
    target: id,
  });
  ensureQuerySucceeded(
    openIssues,
    "Falha ao consultar pendências do atendimento",
  );

  return (
    <>
      <OrderHeader order={order} header={orderHeader.data?.[0]} />
      <Notice error={query.erro} />
      <OrderCycle order={order} />
      {admin && <OrderDelete id={id} version={order.version} />}
      <OrderTriage
        id={id}
        version={order.version}
        actions={workflowOperations}
        responsibleMemberships={responsibleOptions.data ?? []}
      />
      <div className="detail-grid">
        <OrderSummary order={order} catalogs={catalogRows} />
        <OrderAttachments
          id={id}
          attachments={attachments.data ?? []}
          policy={attachmentPolicies.data?.[0]}
          canPost={canPost}
        />
      </div>
      <OrderService
        actionPresentation={actionCatalog.rows}
        serviceEntryTypes={serviceTypes.data ?? []}
        id={id}
        version={order.version}
        entries={serviceEntries.data ?? []}
        openIssues={openIssues.data ?? []}
        actions={workflowOperations}
        canAdd={workflowOperations.some(
          ({ operation }) => operation === workflowActionNames.addServiceEntry,
        )}
      />
      <OrderTimeline
        orderId={id}
        events={timeline.data ?? []}
        page={timelinePage}
        total={Number(timeline.data?.[0]?.total_count ?? 0)}
      />
      <OrderActivity
        id={id}
        userId={user.id}
        messages={messages.data ?? []}
        canPost={canPost}
      />
    </>
  );
}
