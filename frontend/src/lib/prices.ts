import { useEffect, useState } from "react";

import { BACKEND_URL } from "@/lib/backend";

export interface Prices {
  USDC: number;
  XLM: number;
}

/** Static fallback (same basis as the previous frontend) until live prices load. */
export const FALLBACK_PRICES: Prices = { USDC: 1, XLM: 0.12 };

const POLL_MS = 60 * 1000;

interface PricesResponse {
  USDC?: unknown;
  XLM?: unknown;
  updatedAt?: unknown;
  stale?: unknown;
}

function sanitize(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** One fetch of live prices through the backend proxy (never CoinGecko direct). */
export async function fetchPrices(): Promise<Prices> {
  const res = await fetch(`${BACKEND_URL}/api/prices`);
  if (!res.ok) throw new Error(`Prices ${res.status}`);
  const data = (await res.json()) as PricesResponse;
  return {
    USDC: sanitize(data.USDC, FALLBACK_PRICES.USDC),
    XLM: sanitize(data.XLM, FALLBACK_PRICES.XLM),
  };
}

/** Live prices, refreshed every 60s. Falls back to static prices on failure. */
export function usePrices(): Prices {
  const [prices, setPrices] = useState<Prices>(FALLBACK_PRICES);
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void fetchPrices()
        .then((p) => {
          if (!cancelled) setPrices(p);
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return prices;
}
