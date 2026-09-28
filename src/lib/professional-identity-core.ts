export const institutionalGoogleDomains = ["edu.uberabadigital.com.br", "uberabadigital.com.br"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInstitutionalEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeGoogleDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

export function allowedGoogleDomains(
  configured = process.env.ALLOWED_GOOGLE_DOMAINS ?? institutionalGoogleDomains.join(","),
): string[] {
  return [...new Set(configured.split(",").map(normalizeGoogleDomain).filter(Boolean))]
    .filter((domain) => institutionalGoogleDomains.includes(domain));
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
    institutionalGoogleDomains.includes(institutionalEmailDomain(normalized)) &&
    domains.includes(institutionalEmailDomain(normalized));
}
