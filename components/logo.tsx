import Link from "next/link";

export function Logo() {
  return (
    <Link className="logo" href="/" aria-label="Hyped home">
      <span>GETHYPED</span>
    </Link>
  );
}
