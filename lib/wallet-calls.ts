type RpcLikeError = {
  cause?: unknown;
  code?: unknown;
  details?: unknown;
  message?: unknown;
  name?: unknown;
  shortMessage?: unknown;
};

export function supportsAtomicCalls(capabilities: unknown) {
  if (!capabilities || typeof capabilities !== "object") return false;
  const atomic = (capabilities as { atomic?: unknown }).atomic;
  if (!atomic || typeof atomic !== "object") return false;
  const status = (atomic as { status?: unknown }).status;
  return status === "supported" || status === "ready";
}

export function isAtomicCallsUnsupported(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const error = reason as RpcLikeError;
  const code = typeof error.code === "number" ? error.code : Number(error.code);
  if (code === -32601 || code === 5760) return true;

  const text = [error.name, error.shortMessage, error.message, error.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (
    text.includes("atomicitynotsupported")
    || text.includes("methodnotfound")
    || text.includes("methodnotsupported")
    || text.includes("wallet_sendcalls is not supported")
    || text.includes("wallet_sendcalls does not exist")
    || text.includes("method not found")
  ) return true;

  return error.cause ? isAtomicCallsUnsupported(error.cause) : false;
}

export async function sendAtomicCallsIfSupported({
  getCapabilities,
  sendCalls,
  waitForCallsStatus,
}: {
  getCapabilities: () => Promise<unknown>;
  sendCalls: () => Promise<{ id: string }>;
  waitForCallsStatus: (id: string) => Promise<{ status?: string }>;
}) {
  let capabilities: unknown;
  try {
    capabilities = await getCapabilities();
  } catch {
    return false;
  }
  if (!supportsAtomicCalls(capabilities)) return false;

  let batch: { id: string };
  try {
    batch = await sendCalls();
  } catch (reason) {
    if (isAtomicCallsUnsupported(reason)) return false;
    throw reason;
  }

  const status = await waitForCallsStatus(batch.id);
  if (status.status !== "success") throw new Error("The wallet batch did not confirm.");
  return true;
}
