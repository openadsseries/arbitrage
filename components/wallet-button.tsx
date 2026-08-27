"use client";

import { CircleAlert, LoaderCircle, Wallet, X } from "lucide-react";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/components/wallet-provider";

export function WalletButton() {
  const { address, chainKey, connecting, error, clearError, connect } = useWallet();
  if (!address) {
    return (
      <div className="wallet-control">
        <button
          aria-describedby={error ? "wallet-error" : undefined}
          className="wallet-button"
          disabled={connecting}
          onClick={() => void connect()}
          type="button"
        >
          {connecting ? <LoaderCircle className="spin" /> : <Wallet />}
          <span>{connecting ? "Connecting" : "Connect wallet"}</span>
        </button>
        {error && (
          <div className="wallet-error" id="wallet-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
            <button aria-label="Dismiss wallet message" onClick={clearError} type="button"><X /></button>
          </div>
        )}
      </div>
    );
  }
  return (
    <button className={`wallet-button connected ${chainKey ? "" : "unsupported"}`} title={chainKey ? `Connected wallet ${address}` : `Unsupported wallet network ${address}`} onClick={() => void connect()} type="button">
      <i aria-hidden="true" />
      <span>{shortAddress(address)}</span>
    </button>
  );
}
