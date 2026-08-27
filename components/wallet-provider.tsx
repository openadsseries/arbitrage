"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  getAddress,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { CHAINS, getChainKeyById, getViemChain, type ChainKey } from "@/lib/chains";
import {
  injectedProviderFrom,
  injectedWalletError,
  type InjectedProvider,
} from "@/lib/injected-wallet";

type WalletContextValue = {
  address: Address | null;
  chainId: number | null;
  chainKey: ChainKey | null;
  available: boolean;
  connecting: boolean;
  error: string;
  clearError: () => void;
  connect: (preferredChain?: ChainKey) => Promise<Address | null>;
  disconnect: () => void;
  switchChain: (chain: ChainKey) => Promise<void>;
  getPublicClient: (chain: ChainKey) => Promise<PublicClient>;
  getWalletClient: (chain: ChainKey) => Promise<WalletClient>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function injectedProvider() {
  if (typeof window === "undefined") return null;
  return injectedProviderFrom(window);
}

function parseChainId(value: unknown) {
  if (typeof value === "string") return Number.parseInt(value, 16);
  if (typeof value === "number") return value;
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [provider, setProvider] = useState<InjectedProvider | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const providerRef = useRef<InjectedProvider | null>(null);
  const available = Boolean(provider);

  const rememberProvider = useCallback((nextProvider: InjectedProvider | null) => {
    providerRef.current = nextProvider;
    setProvider((current) => current === nextProvider ? current : nextProvider);
    return nextProvider;
  }, []);

  const currentProvider = useCallback(() => {
    const nextProvider = injectedProvider();
    if (nextProvider && nextProvider !== providerRef.current) rememberProvider(nextProvider);
    return nextProvider ?? providerRef.current;
  }, [rememberProvider]);

  const sync = useCallback(async (targetProvider?: InjectedProvider | null) => {
    const activeProvider = targetProvider ?? currentProvider();
    if (!activeProvider) return;
    const [accounts, nextChainId] = await Promise.all([
      activeProvider.request({ method: "eth_accounts" }) as Promise<string[]>,
      activeProvider.request({ method: "eth_chainId" }),
    ]);
    setAddress(accounts[0] ? getAddress(accounts[0]) : null);
    setChainId(parseChainId(nextChainId));
  }, [currentProvider]);

  useEffect(() => {
    let checks = 0;
    const detect = () => {
      const nextProvider = injectedProvider();
      if (nextProvider) rememberProvider(nextProvider);
      return Boolean(nextProvider);
    };
    detect();
    const handleInitialized = () => detect();
    window.addEventListener("ethereum#initialized", handleInitialized);
    const timer = window.setInterval(() => {
      checks += 1;
      if (detect() || checks >= 12) window.clearInterval(timer);
    }, 250);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("ethereum#initialized", handleInitialized);
    };
  }, [rememberProvider]);

  useEffect(() => {
    if (!provider) return;
    // Initial account hydration synchronizes React with the injected wallet.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync(provider).catch(() => undefined);
    const handleAccounts = () => void sync(provider).catch(() => undefined);
    const handleChain = () => void sync(provider).catch(() => undefined);
    provider.on?.("accountsChanged", handleAccounts);
    provider.on?.("chainChanged", handleChain);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged", handleChain);
    };
  }, [provider, sync]);

  const switchChain = useCallback(async (chain: ChainKey) => {
    const provider = currentProvider();
    if (!provider) throw new Error("Wallet extension needed.");
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
  }, [currentProvider, sync]);

  const connect = useCallback(async (preferredChain?: ChainKey) => {
    const provider = currentProvider();
    if (!provider) {
      setError("Wallet extension needed. Install or enable one, then try again.");
      return null;
    }
    setConnecting(true);
    setError("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const nextAddress = accounts[0] ? getAddress(accounts[0]) : null;
      if (!nextAddress) throw new Error("No wallet account was returned.");
      setAddress(nextAddress);
      if (preferredChain) await switchChain(preferredChain);
      await sync(provider);
      return nextAddress;
    } catch (reason) {
      setError(injectedWalletError(reason));
      return null;
    } finally {
      setConnecting(false);
    }
  }, [currentProvider, switchChain, sync]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError("");
  }, []);

  const clearError = useCallback(() => setError(""), []);

  const getWalletClient = useCallback(async (chain: ChainKey) => {
    const provider = currentProvider();
    if (!provider) throw new Error("Wallet extension needed.");
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
  }, [currentProvider, switchChain]);

  const getPublicClient = useCallback(async (chain: ChainKey) => {
    const provider = currentProvider();
    if (!provider) throw new Error("No injected wallet was found.");
    const expected = CHAINS[chain].id;
    const current = parseChainId(await provider.request({ method: "eth_chainId" }));
    if (current !== expected) await switchChain(chain);
    return createPublicClient({
      chain: getViemChain(chain),
      transport:
        chain === "base"
          ? fallback([
              http("https://base-rpc.publicnode.com", {
                retryCount: 1,
                timeout: 8_000,
              }),
              http(`${window.location.origin}/api/rpc/base`, {
                retryCount: 0,
                timeout: 8_000,
              }),
            ])
          : http(`${window.location.origin}/api/rpc/${chain}`),
    });
  }, [currentProvider, switchChain]);

  const value = useMemo<WalletContextValue>(() => ({
    address,
    chainId,
    chainKey: chainId ? getChainKeyById(chainId) : null,
    available,
    connecting,
    error,
    clearError,
    connect,
    disconnect,
    switchChain,
    getPublicClient,
    getWalletClient,
  }), [address, available, chainId, clearError, connect, connecting, disconnect, error, getPublicClient, getWalletClient, switchChain]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider.");
  return context;
}
