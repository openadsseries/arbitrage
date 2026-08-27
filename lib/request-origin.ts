export function validateSameOriginJson({
  requestUrl,
  origin,
  fetchSite,
  contentType,
  forwardedHost,
  forwardedProtocol,
}: {
  requestUrl: string;
  origin: string | null;
  fetchSite: string | null;
  contentType: string | null;
  forwardedHost: string | null;
  forwardedProtocol: string | null;
}) {
  if (fetchSite === "cross-site") return 403;
  const origins = new Set([new URL(requestUrl).origin]);
  if (forwardedHost) {
    origins.add(`${forwardedProtocol ?? "https"}://${forwardedHost}`);
  }
  if (!origin || !origins.has(origin)) return 403;
  if (!(contentType ?? "").toLowerCase().startsWith("application/json"))
    return 415;
  return null;
}
