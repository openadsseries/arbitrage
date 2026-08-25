"use client";

import { LoaderCircle, Wallet } from "lucide-react";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/components/wallet-provider";

export function WalletButton() {
  const { address, chainKey, connecting, connect } = useWallet();
  if (!address) {
    return (
      <button className="wallet-button" disabled={connecting} onClick={() => void connect()} type="button">
        {connecting ? <LoaderCircle className="spin" /> : <Wallet />}
        <span>Connect wallet</span>
      </button>
    );
  }
  return (
    <button className={`wallet-button connected ${chainKey ? "" : "unsupported"}`} title={chainKey ? `Connected wallet ${address}` : `Unsupported wallet network ${address}`} onClick={() => void connect()} type="button">
      <i aria-hidden="true" />
      <span>{shortAddress(address)}</span>
    </button>
  );
}
