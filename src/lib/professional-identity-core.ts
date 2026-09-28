export const institutionalGoogleDomain = "edu.uberabadigital.com.br";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInstitutionalEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeGoogleDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

export function allowedGoogleDomains(
  configured = process.env.ALLOWED_GOOGLE_DOMAINS ?? institutionalGoogleDomain,
): string[] {
  return [...new Set(configured.split(",").map(normalizeGoogleDomain).filter(Boolean))]
    .filter((domain) => domain === institutionalGoogleDomain);
}

export function institutionalEmailDomain(email: string) {
  const normalized = normalizeInstitutionalEmail(email);
  const separator = normalized.lastIndexOf("@");
  return separator > 0 ? normalized.slice(separator + 1) : "";
}

export function isAllowedGoogleEmail(
  email: string,
  domains = allowedGoogleDomains(),
) {
  const normalized = normalizeInstitutionalEmail(email);
  return normalized.length <= 254 && emailPattern.test(normalized) &&
    institutionalEmailDomain(normalized) === institutionalGoogleDomain &&
    domains.includes(institutionalEmailDomain(normalized));
}
