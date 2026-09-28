"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { configured, supabase } from "@/lib/supabase";
import { allowedGoogleDomains } from "@/lib/professional-identity";

async function applicationOrigin() {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredOrigin) return new URL(configuredOrigin).origin;
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin) return new URL(origin).origin;
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  if (!host) throw new Error("Origem da aplicação não configurada");
  return new URL(`${protocol}://${host}`).origin;
}

export async function loginWithGoogle() {
  if (!configured()) redirect("/configuracao");
  if (allowedGoogleDomains().length === 0)
    redirect("/login?oauth=configuracao");
  const db = await supabase();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await applicationOrigin()}/auth/callback`,
      scopes: "openid email profile",
      // Não fixa hd em um domínio: o callback valida os dois domínios no servidor.
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/login?oauth=indisponivel");
  redirect(data.url);
}

export async function logout() {
  if (!configured()) redirect("/configuracao");
  const db = await supabase();
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) redirect("/login?logout=erro");
  redirect("/login");
}
