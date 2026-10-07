import { catalogManagementScope } from "@/lib/catalog-management";
import { session } from "@/lib/session";
import { Shell } from "@/components/shell";
import { getUserPermissions } from "@/lib/authorization";
import { pendingAcknowledgements } from "@/app/actions/acknowledgements";
import { AcknowledgementGate } from "@/components/acknowledgement-gate";
import { googleAvatarUrl } from "@/lib/google-avatar";
export const dynamic = "force-dynamic";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, admin, db } = await session();
  const permissions = await getUserPermissions(db);
  const catalogScope = await catalogManagementScope(db);
  const acknowledgements = await pendingAcknowledgements();
  return (
    <AcknowledgementGate initial={acknowledgements}>
      <Shell
        name={user.email ?? "Conta institucional"}
        avatarUrl={googleAvatarUrl(user.user_metadata)}
        admin={admin}
        managedCatalogKinds={catalogScope.kinds}
        permissions={[...permissions]}
      >
        {children}
      </Shell>
    </AcknowledgementGate>
  );
}
