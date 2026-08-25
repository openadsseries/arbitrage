import Image from "next/image";

export function tokenLogoUrl(address: string, chainId = 8453) {
  return `https://fc.hunt.town/tokens/logo/${chainId}/${address}/image`;
}

export function TokenLogo({
  address,
  label,
  role,
  compact = false,
}: {
  address: string;
  label: string;
  role?: string;
  compact?: boolean;
}) {
  return (
    <div className={`token-asset${compact ? " compact" : ""}`}>
      <span className="token-logo">
        <Image src={tokenLogoUrl(address)} alt={`${label} token logo`} width={72} height={72} unoptimized />
      </span>
      {!compact && <strong>{label}</strong>}
      {!compact && role && <small>{role}</small>}
    </div>
  );
}
