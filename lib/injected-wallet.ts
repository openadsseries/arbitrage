import type { EIP1193Provider } from "viem";

export type InjectedProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function validProvider(candidate: unknown): InjectedProvider | null {
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function"))
    return null;
  if (!("request" in candidate) || typeof candidate.request !== "function")
    return null;
  return candidate as InjectedProvider;
}

function nested(source: unknown, key: string) {
  if (!source || (typeof source !== "object" && typeof source !== "function"))
    return null;
  return key in source ? (source as Record<string, unknown>)[key] : null;
}

export function injectedProviderFrom(source: unknown): InjectedProvider | null {
  const ethereum = nested(source, "ethereum");
  const direct = validProvider(ethereum);
  if (direct) return direct;

  const providers = nested(ethereum, "providers");
  if (Array.isArray(providers)) {
    const okx = providers.find((provider) => Boolean(nested(provider, "isOkxWallet")));
    const preferred = validProvider(okx) ?? validProvider(providers[0]);
    if (preferred) return preferred;
  }

  const okxWallet = nested(source, "okxwallet") ?? nested(source, "okxWallet");
  return validProvider(nested(okxWallet, "ethereum")) ?? validProvider(okxWallet);
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
