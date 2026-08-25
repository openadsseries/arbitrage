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

function validCall(value: unknown): value is RpcRequest {
  if (!value || typeof value !== "object") return false;
  const call = value as RpcRequest;
  return call.jsonrpc === "2.0" && typeof call.method === "string" && READ_METHODS.has(call.method);
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
    return new Response(await upstream.text(), {
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
