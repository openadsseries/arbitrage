import { NextResponse } from "next/server";
import { CHAINS, type ChainKey } from "@/lib/chains";

export const dynamic = "force-dynamic";

const READ_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
]);

type RpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id: unknown;
  error: {
    code: number;
    message: string;
  };
};

function validCall(value: unknown): value is RpcRequest {
  if (!value || typeof value !== "object") return false;
  const call = value as RpcRequest;
  return call.jsonrpc === "2.0" && typeof call.method === "string" && READ_METHODS.has(call.method);
}

function rateLimited(value: string) {
  return /over rate limit|rate.?limit|too many requests|429/i.test(value);
}

function errorForCall(call: RpcRequest, message: string, code = -32005): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id: call.id ?? null,
    error: { code, message },
  };
}

function errorForCalls(calls: RpcRequest[], batched: boolean, message: string, code?: number) {
  const errors = calls.map((call) => errorForCall(call, message, code));
  return batched ? errors : errors[0];
}

function normalizeRateLimitErrors(payload: unknown): { payload: unknown; changed: boolean } {
  const normalize = (item: unknown) => {
    if (!item || typeof item !== "object") return { item, changed: false };
    const rpc = item as { jsonrpc?: unknown; id?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
    const message = typeof rpc.error?.message === "string" ? rpc.error.message : "";
    const data = typeof rpc.error?.data === "string" ? rpc.error.data : "";
    if (!rateLimited(`${message} ${data}`)) return { item, changed: false };
    return {
      item: errorForCall(
        { jsonrpc: "2.0", id: rpc.id },
        "Base RPC is busy. Wait a moment and try again.",
      ),
      changed: true,
    };
  };

  if (Array.isArray(payload)) {
    let changed = false;
    const next = payload.map((item) => {
      const result = normalize(item);
      changed ||= result.changed;
      return result.item;
    });
    return { payload: next, changed };
  }
  const result = normalize(payload);
  return { payload: result.item, changed: result.changed };
}

export async function POST(request: Request, context: { params: Promise<{ chain: string }> }) {
  try {
    const { chain } = await context.params;
    if (!(chain in CHAINS)) return NextResponse.json({ error: "Unsupported network." }, { status: 404 });
    const text = await request.text();
    if (text.length > 65_536) return NextResponse.json({ error: "RPC request is too large." }, { status: 413 });
    const body = JSON.parse(text) as unknown;
    const calls = Array.isArray(body) ? body : [body];
    if (calls.length === 0 || calls.length > 10 || !calls.every(validCall)) {
      return NextResponse.json({ error: "Only limited read-only RPC calls are allowed." }, { status: 400 });
    }

    const capability = CHAINS[chain as ChainKey];
    const upstream = await fetch(capability.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
      cache: "no-store",
    });
    const upstreamText = await upstream.text();
    if (!upstream.ok && rateLimited(upstreamText)) {
      return NextResponse.json(
        errorForCalls(calls, Array.isArray(body), "Base RPC is busy. Wait a moment and try again."),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      const payload = JSON.parse(upstreamText) as unknown;
      const normalized = normalizeRateLimitErrors(payload);
      if (normalized.changed) {
        return NextResponse.json(normalized.payload, { headers: { "Cache-Control": "no-store" } });
      }
    } catch {
      if (rateLimited(upstreamText)) {
        return NextResponse.json(
          errorForCalls(calls, Array.isArray(body), "Base RPC is busy. Wait a moment and try again."),
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    return new Response(upstreamText, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "RPC read failed." },
      { status: 502 },
    );
  }
}
