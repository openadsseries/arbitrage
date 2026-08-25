"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet-button";

const links = [
  { href: "/launch", label: "Create a pool" },
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/security", label: "Security" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMarketDetail = /^\/market\/[^/]+\/[^/]+/.test(pathname);
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="topbar">
        <div className="nav-wrap">
          <Logo />
          <nav className={open ? "main-nav open" : "main-nav"} aria-label="Primary navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`)) ? "active" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="nav-actions">
            <WalletButton />
            <button className="menu-toggle" onClick={() => setOpen(!open)} aria-label="Open menu">
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main className={isMarketDetail ? "market-detail-shell" : undefined}>{children}</main>
      {!isMarketDetail && (
        <footer className="footer">
          <div><Logo /><p>Existing tokens connected to new Hyped Token pools.</p></div>
          <div className="footer-meta"><span>Onchain</span><span>Non-custodial</span><span>Wallet-signed</span></div>
        </footer>
      )}
    </>
  );
}
