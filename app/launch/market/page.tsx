import { redirect } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { ExistingMarketLaunch } from "@/components/existing-market-launch";
import { readVerifiedMarket } from "@/lib/server/markets";

export default async function ExistingMarketLaunchPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const value = (await searchParams).token;
  const token = Array.isArray(value) ? value[0] : value ?? "";
  if (isAddress(token)) {
    const market = await readVerifiedMarket("base", getAddress(token)).catch(() => null);
    if (market?.directMarket) redirect(`/market/base/${market.token}`);
  }
  return <ExistingMarketLaunch token={token} />;
}
