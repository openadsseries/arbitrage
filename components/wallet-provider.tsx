"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from "viem";
import { CHAINS, getChainKeyById, getViemChain, type ChainKey } from "@/lib/chains";

type InjectedProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type WalletContextValue = {
  address: Address | null;
  chainId: number | null;
  chainKey: ChainKey | null;
  available: boolean;
  connecting: boolean;
  error: string;
  connect: (preferredChain?: ChainKey) => Promise<Address | null>;
  disconnect: () => void;
  switchChain: (chain: ChainKey) => Promise<void>;
  getPublicClient: (chain: ChainKey) => Promise<PublicClient>;
  getWalletClient: (chain: ChainKey) => Promise<WalletClient>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function injectedProvider() {
  if (typeof window === "undefined") return null;
  return (window as Window & { ethereum?: InjectedProvider }).ethereum ?? null;
}

function parseChainId(value: unknown) {
  if (typeof value === "string") return Number.parseInt(value, 16);
  if (typeof value === "number") return value;
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const available = Boolean(injectedProvider());

  const sync = useCallback(async () => {
    const provider = injectedProvider();
    if (!provider) return;
    const [accounts, nextChainId] = await Promise.all([
      provider.request({ method: "eth_accounts" }) as Promise<string[]>,
      provider.request({ method: "eth_chainId" }),
    ]);
    setAddress(accounts[0] ? getAddress(accounts[0]) : null);
    setChainId(parseChainId(nextChainId));
  }, []);

  useEffect(() => {
    const provider = injectedProvider();
    if (!provider) return;
    // Initial account hydration synchronizes React with the injected wallet.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    const handleAccounts = () => void sync();
    const handleChain = () => void sync();
    provider.on?.("accountsChanged", handleAccounts);
    provider.on?.("chainChanged", handleChain);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged", handleChain);
    };
  }, [sync]);

  const switchChain = useCallback(async (chain: ChainKey) => {
    const provider = injectedProvider();
    if (!provider) throw new Error("Install or enable an injected wallet to continue.");
    const capability = CHAINS[chain];
    const hexChainId = `0x${capability.id.toString(16)}`;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      });
    } catch (reason) {
      const code = typeof reason === "object" && reason && "code" in reason ? Number(reason.code) : null;
      if (code !== 4902) throw reason;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexChainId,
          chainName: capability.name,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [capability.rpcUrl],
          blockExplorerUrls: [capability.explorerUrl],
        }],
      });
    }
    await sync();
  }, [sync]);

  const connect = useCallback(async (preferredChain?: ChainKey) => {
    const provider = injectedProvider();
    if (!provider) {
      setError("No injected wallet was found.");
      return null;
    }
    setConnecting(true);
    setError("");
    try {
      if (preferredChain) await switchChain(preferredChain);
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const nextAddress = accounts[0] ? getAddress(accounts[0]) : null;
      setAddress(nextAddress);
      await sync();
      return nextAddress;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Wallet connection was cancelled.");
      return null;
    } finally {
      setConnecting(false);
    }
  }, [switchChain, sync]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError("");
  }, []);

  const getWalletClient = useCallback(async (chain: ChainKey) => {
    const provider = injectedProvider();
    if (!provider) throw new Error("No injected wallet was found.");
    const expected = CHAINS[chain].id;
    const current = parseChainId(await provider.request({ method: "eth_chainId" }));
    if (current !== expected) await switchChain(chain);
    const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
    if (!accounts[0]) throw new Error("Connect a wallet to continue.");
    return createWalletClient({
      account: getAddress(accounts[0]),
      chain: getViemChain(chain),
      transport: custom(provider),
    });
  }, [switchChain]);

  const getPublicClient = useCallback(async (chain: ChainKey) => {
    const provider = injectedProvider();
    if (!provider) throw new Error("No injected wallet was found.");
    const expected = CHAINS[chain].id;
    const current = parseChainId(await provider.request({ method: "eth_chainId" }));
    if (current !== expected) await switchChain(chain);
    return createPublicClient({
      chain: getViemChain(chain),
      transport: http(`${window.location.origin}/api/rpc/${chain}`),
    });
  }, [switchChain]);

  const value = useMemo<WalletContextValue>(() => ({
    address,
    chainId,
    chainKey: chainId ? getChainKeyById(chainId) : null,
    available,
    connecting,
    error,
    connect,
    disconnect,
    switchChain,
    getPublicClient,
    getWalletClient,
  }), [address, available, chainId, connect, connecting, disconnect, error, getPublicClient, getWalletClient, switchChain]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider.");
  return context;
}
