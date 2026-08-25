import { ArrowRight, CheckCircle2, FileKey2, ScanSearch, Settings2 } from "lucide-react";

const STEPS = [
  { number: "01", title: "Read", detail: "Onchain token data", icon: ScanSearch },
  { number: "02", title: "Configure", detail: "Pricing and backing", icon: Settings2 },
  { number: "03", title: "Validate", detail: "Encoded contract call", icon: CheckCircle2 },
  { number: "04", title: "Sign", detail: "Wallet confirmation", icon: FileKey2 },
] as const;

export function LaunchFlowVisual() {
  return (
    <div className="launch-flow-visual" aria-label="One OG token contract moves through reading, Mint Club validation and wallet confirmation">
      <div className="pipeline-head">
        <div><span>Input</span><strong>OG token contract</strong></div>
        <ArrowRight aria-hidden="true" />
        <div><span>Output</span><strong>Connected Hyped Token pool</strong></div>
      </div>
      <div className="pipeline-track" aria-hidden="true"><i /></div>
      <ol className="pipeline-steps">
        {STEPS.map(({ number, title, detail, icon: Icon }) => (
          <li key={number}>
            <span>{number}</span>
            <Icon aria-hidden="true" />
            <strong>{title}</strong>
            <small>{detail}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}
