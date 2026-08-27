import type { EIP1193Provider } from "viem";

export type InjectedProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export function injectedProviderFrom(source: unknown): InjectedProvider | null {
  if (!source || (typeof source !== "object" && typeof source !== "function")) return null;
  const candidate = (source as { ethereum?: unknown }).ethereum;
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) return null;
  if (!("request" in candidate) || typeof candidate.request !== "function") return null;
  return candidate as InjectedProvider;
}

function walletErrorCode(reason: unknown): number | null {
  if (!reason || typeof reason !== "object") return null;
  if ("code" in reason && Number.isFinite(Number(reason.code))) return Number(reason.code);
  return "cause" in reason ? walletErrorCode(reason.cause) : null;
}

export function injectedWalletError(reason: unknown) {
  switch (walletErrorCode(reason)) {
    case 4001:
      return "Connection cancelled in wallet.";
    case -32002:
      return "Open your wallet to finish connecting.";
    case 4100:
      return "Allow this site in your wallet, then try again.";
    case 4900:
      return "Wallet is offline. Reopen it and try again.";
    case 4901:
      return "This network is unavailable in your wallet.";
    default:
      return "Wallet connection failed. Try again.";
  }
}
