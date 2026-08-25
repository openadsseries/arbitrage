import { LaunchStarter } from "@/components/launch-starter";
import { LaunchRecovery } from "@/components/launch-recovery";
import { getTrendingTokens } from "@/lib/server/trending";

export default async function NewLaunchPage() {
  const trendingTokens = await getTrendingTokens();

  return (
    <div className="launch-entry page-shell">
      <header className="launch-entry-head">
        <span className="kicker">Create a pool</span>
        <h1>Start with an OG token.</h1>
        <p>Enter a contract or choose a trending token. GETHYPED creates its connected Hyped Token and pool.</p>
      </header>

      <section className="launch-entry-card launch-entry-selector" aria-label="Choose and verify the OG token">
        <LaunchStarter trendingTokens={trendingTokens} />
      </section>

      <LaunchRecovery />
    </div>
  );
}
