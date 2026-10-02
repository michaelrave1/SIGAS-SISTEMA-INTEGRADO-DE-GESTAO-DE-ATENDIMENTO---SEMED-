import type { PermissionKey } from "./authorization-core";

export type NavigationItem = {
  id:
    | "dashboard"
    | "orders"
    | "units"
    | "logistics"
    | "routes"
    | "vehicles"
    | "drivers"
    | "professionals"
    | "audit"
    | "access_profiles"
    | "system_catalogs";
  href: string;
  label: string;
  permission: PermissionKey;
  section: "main" | "catalogs" | "administration";
  requiresAdministrator?: boolean;
};

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export type NavigationContext = {
  title: string;
  breadcrumbs: readonly BreadcrumbItem[];
};

export const navigationItems: readonly NavigationItem[] = [
  {
    id: "dashboard",
    href: "/painel",
    label: "Visão geral",
    permission: "dashboard.view",
    section: "main",
  },
  {
    id: "orders",
    href: "/ordens",
    label: "Ordens de serviço",
    permission: "orders.view",
    section: "main",
  },
  {
    id: "units",
    href: "/unidades",
    label: "Unidades",
    permission: "units.view",
    section: "catalogs",
  },
  {
    id: "logistics",
    href: "/cadastros/logistics",
    label: "Logística",
    permission: "logistics.view",
    section: "catalogs",
    requiresAdministrator: true,
  },
  {
    id: "routes",
    href: "/cadastros/routes",
    label: "Rotas",
    permission: "routes.view",
    section: "catalogs",
    requiresAdministrator: true,
  },
  {
    id: "vehicles",
    href: "/cadastros/vehicles",
    label: "Veículos",
    permission: "vehicles.view",
    section: "catalogs",
    requiresAdministrator: true,
  },
  {
    id: "drivers",
    href: "/cadastros/drivers",
    label: "Motoristas",
    permission: "drivers.view",
    section: "catalogs",
    requiresAdministrator: true,
  },
  {
    id: "professionals",
    href: "/usuarios",
    label: "Usuários e vínculos",
    permission: "professionals.view",
    section: "administration",
    requiresAdministrator: true,
  },
  {
    id: "audit",
    href: "/auditoria",
    label: "Auditoria",
    permission: "audit.view",
    section: "administration",
    requiresAdministrator: true,
  },
  {
    id: "access_profiles",
    href: "/perfis",
    label: "Perfis e permissões",
    permission: "professionals.manage",
    section: "administration",
    requiresAdministrator: true,
  },
  {
    id: "system_catalogs",
    href: "/administracao/cadastros",
    label: "Cadastros do Sistema",
    permission: "system_catalogs.manage",
    section: "administration",
    requiresAdministrator: true,
  },
] as const;

export function visibleNavigationItems(
  permissions: ReadonlySet<PermissionKey>,
  administrator: boolean,
  managedCatalogKinds: readonly string[] = [],
) {
  return navigationItems.filter(
    (item) =>
      permissions.has(item.permission) &&
      (!item.requiresAdministrator ||
        administrator ||
        (["logistics", "routes", "vehicles", "drivers"].includes(item.id) &&
          managedCatalogKinds.includes(item.id))),
  );
}

export function firstAuthorizedRoute(
  permissions: ReadonlySet<PermissionKey>,
  administrator: boolean,
) {
  return (
    visibleNavigationItems(permissions, administrator)[0]?.href ?? "/sem-acesso"
  );
}

const staticContexts: Readonly<Record<string, NavigationContext>> = {
  "/administracao/cadastros/acoes-atendimento": {
    title: "Ações de atendimento",
    breadcrumbs: [
      { label: "Administração" },
      { label: "Cadastros do Sistema", href: "/administracao/cadastros" },
      { label: "Ações de atendimento" },
    ],
  },
  "/administracao/cadastros": {
    title: "Cadastros do Sistema",
    breadcrumbs: [
      { label: "Administração" },
      { label: "Cadastros do Sistema" },
    ],
  },
  "/administracao/cadastros/atendimentos": {
    title: "Tipos de Registro de Atendimento",
    breadcrumbs: [
      { label: "Administração" },
      { label: "Cadastros do Sistema", href: "/administracao/cadastros" },
      { label: "Tipos de Registro de Atendimento" },
    ],
  },
  "/painel": {
    title: "Visão geral",
    breadcrumbs: [{ label: "Início" }],
  },
  "/ordens": {
    title: "Ordens de Serviço",
    breadcrumbs: [{ label: "Ordens de Serviço" }],
  },
  "/ordens/nova": {
    title: "Nova Ordem de Serviço",
    breadcrumbs: [
      { label: "Ordens de Serviço", href: "/ordens" },
      { label: "Nova" },
    ],
  },
  "/unidades": {
    title: "Unidades",
    breadcrumbs: [{ label: "Cadastros" }, { label: "Unidades" }],
  },
  "/cadastros/logistics": {
    title: "Classificações logísticas",
    breadcrumbs: [
      { label: "Cadastros" },
      { label: "Classificações logísticas" },
    ],
  },
  "/cadastros/routes": {
    title: "Rotas",
    breadcrumbs: [{ label: "Cadastros" }, { label: "Rotas" }],
  },
  "/cadastros/vehicles": {
    title: "Veículos",
    breadcrumbs: [{ label: "Cadastros" }, { label: "Veículos" }],
  },
  "/cadastros/drivers": {
    title: "Motoristas",
    breadcrumbs: [{ label: "Cadastros" }, { label: "Motoristas" }],
  },
  "/usuarios": {
    title: "Profissionais e vínculos",
    breadcrumbs: [{ label: "Administração" }, { label: "Usuários e vínculos" }],
  },
  "/perfis": {
    title: "Perfis e permissões",
    breadcrumbs: [{ label: "Administração" }, { label: "Perfis e permissões" }],
  },
  "/auditoria": {
    title: "Auditoria",
    breadcrumbs: [{ label: "Administração" }, { label: "Auditoria" }],
  },
  "/sem-acesso": {
    title: "Acesso indisponível",
    breadcrumbs: [{ label: "Sem acesso" }],
  },
};

export function navigationContext(pathname: string): NavigationContext {
  const normalized = pathname !== "/" ? pathname.replace(/\/$/, "") : pathname;
  const exact = staticContexts[normalized];
  if (exact) return exact;
  if (normalized.startsWith("/ordens/"))
    return {
      title: "Detalhes da Ordem de Serviço",
      breadcrumbs: [
        { label: "Ordens de Serviço", href: "/ordens" },
        { label: "Detalhes" },
      ],
    };
  return {
    title: "OS SEMED",
    breadcrumbs: [{ label: "OS SEMED" }],
  };
}
