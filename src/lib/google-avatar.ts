export function googleAvatarUrl(metadata: Record<string, unknown>) {
  for (const value of [metadata.avatar_url, metadata.picture]) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        (url.hostname === "googleusercontent.com" ||
          url.hostname.endsWith(".googleusercontent.com"))
      ) {
        return url.href;
      }
    } catch {
      // Invalid metadata must never prevent access to the application.
    }
  }
  return null;
}
