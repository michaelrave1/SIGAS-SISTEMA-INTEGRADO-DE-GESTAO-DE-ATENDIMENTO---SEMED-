import { session } from "@/lib/session";
import { Shell } from "@/components/shell";
import { getUserPermissions } from "@/lib/authorization";
import { pendingAcknowledgements } from "@/app/actions/acknowledgements";
import { AcknowledgementGate } from "@/components/acknowledgement-gate";
export const dynamic = "force-dynamic";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, admin, db } = await session();
  const permissions = await getUserPermissions(db);
  const acknowledgements = await pendingAcknowledgements();
  return (
    <AcknowledgementGate initial={acknowledgements}>
      <Shell
        name={user.email ?? "Conta institucional"}
        admin={admin}
        permissions={[...permissions]}
      >
        {children}
      </Shell>
    </AcknowledgementGate>
  );
}
