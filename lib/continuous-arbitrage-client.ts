"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Address } from "viem";
import type { ContinuousArbitrageSnapshot } from "@/lib/arbitrage";

type SnapshotState = {
  snapshot: ContinuousArbitrageSnapshot | null;
  error: string;
  loading: boolean;
};

type SnapshotEntry = {
  address: Address;
  state: SnapshotState;
  updatedAt: number;
  inFlight: Promise<ContinuousArbitrageSnapshot> | null;
  listeners: Set<() => void>;
  timer: number | null;
  refreshWhenVisible: (() => void) | null;
};

const EMPTY_STATE: SnapshotState = {
  snapshot: null,
  error: "",
  loading: false,
};
const FRESH_MS = 5_000;
const POLL_MS = 30_000;
const entries = new Map<string, SnapshotEntry>();

function entryFor(address: Address) {
  const key = address.toLowerCase();
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      address,
      state: EMPTY_STATE,
      updatedAt: 0,
      inFlight: null,
      listeners: new Set(),
      timer: null,
      refreshWhenVisible: null,
    };
    entries.set(key, entry);
  }
  return entry;
}

function publish(entry: SnapshotEntry, state: SnapshotState) {
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

export function readContinuousArbitrageSnapshot(
  address: Address,
  options: { force?: boolean } = {},
) {
  const entry = entryFor(address);
  if (entry.inFlight) return entry.inFlight;
  if (
    !options.force &&
    entry.state.snapshot &&
    Date.now() - entry.updatedAt < FRESH_MS
  ) {
    return Promise.resolve(entry.state.snapshot);
  }

  publish(entry, { ...entry.state, loading: !entry.state.snapshot, error: "" });
  const request = fetch(`/api/arbitrage/v3?wallet=${address}`, {
    cache: "no-store",
  })
    .then(async (response) => {
      const payload = (await response.json()) as {
        snapshot?: ContinuousArbitrageSnapshot;
        error?: string;
      };
      if (!response.ok || !payload.snapshot)
        throw new Error(payload.error ?? "Could not read arbitrage.");
      entry.updatedAt = Date.now();
      publish(entry, { snapshot: payload.snapshot, error: "", loading: false });
      return payload.snapshot;
    })
    .catch((reason) => {
      const message =
        reason instanceof Error ? reason.message : "Could not read arbitrage.";
      publish(entry, { ...entry.state, error: message, loading: false });
      throw reason;
    })
    .finally(() => {
      entry.inFlight = null;
    });
  entry.inFlight = request;
  return request;
}

export function refreshContinuousArbitrageSnapshot(address: Address) {
  return readContinuousArbitrageSnapshot(address, { force: true });
}

function subscribe(address: Address, listener: () => void) {
  const entry = entryFor(address);
  entry.listeners.add(listener);
  if (entry.listeners.size === 1) {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshContinuousArbitrageSnapshot(entry.address).catch(
          () => undefined,
        );
      }
    };
    entry.refreshWhenVisible = refreshWhenVisible;
    entry.timer = window.setInterval(refreshWhenVisible, POLL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.refreshWhenVisible) {
      if (entry.timer !== null) window.clearInterval(entry.timer);
      window.removeEventListener("focus", entry.refreshWhenVisible);
      document.removeEventListener(
        "visibilitychange",
        entry.refreshWhenVisible,
      );
      entry.timer = null;
      entry.refreshWhenVisible = null;
    }
  };
}

export function useContinuousArbitrageSnapshot(
  address: Address | null | undefined,
) {
  const subscribeToAddress = useCallback(
    (listener: () => void) =>
      address ? subscribe(address, listener) : () => undefined,
    [address],
  );
  const getSnapshot = useCallback(
    () => (address ? entryFor(address).state : EMPTY_STATE),
    [address],
  );
  const state = useSyncExternalStore(
    subscribeToAddress,
    getSnapshot,
    () => EMPTY_STATE,
  );

  useEffect(() => {
    if (address)
      void readContinuousArbitrageSnapshot(address).catch(() => undefined);
  }, [address]);

  return state;
}
