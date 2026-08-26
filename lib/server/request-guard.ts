import "server-only";

type RateEntry = { count: number; resetAt: number };

const globalRateStore = globalThis as typeof globalThis & {
  __gethypedRateLimits?: Map<string, RateEntry>;
};

const rateLimits = (globalRateStore.__gethypedRateLimits ??= new Map<
  string,
  RateEntry
>());

function requestAddress(request: Request) {
  return (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function rateLimit(
  request: Request,
  scope: string,
  options: { limit: number; windowMs: number; key?: string },
) {
  const now = Date.now();
  const key = `${scope}:${options.key ?? requestAddress(request)}`;
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }
  if (current.count >= options.limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1_000));
    return Response.json(
      { error: "Too many requests. Try again soon." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }
  current.count += 1;
  if (rateLimits.size > 5_000) {
    for (const [entryKey, entry] of rateLimits) {
      if (entry.resetAt <= now) rateLimits.delete(entryKey);
    }
    while (rateLimits.size > 5_000) {
      const oldestKey = rateLimits.keys().next().value;
      if (typeof oldestKey !== "string") break;
      rateLimits.delete(oldestKey);
    }
  }
  return null;
}

export async function readBoundedJson(request: Request, maximumBytes = 16_384) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new RequestGuardError("Request is too large.", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new RequestGuardError("Request is too large.", 413);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestGuardError("Invalid JSON request.", 400);
  }
}

export async function readBoundedResponseJson(
  response: Response,
  maximumBytes = 1_000_000,
) {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error("Upstream response is too large.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new Error("Upstream response is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Upstream returned an invalid response.");
  }
}

export class RequestGuardError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestGuardError";
    this.status = status;
  }
}
