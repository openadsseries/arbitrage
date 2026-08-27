"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CirclePlus, Home, Menu, ShieldCheck, WalletCards, X } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { WalletButton } from "@/components/wallet-button";

const links = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/markets", label: "Markets", icon: BarChart3 },
  { href: "/launch", label: "Create a pool", icon: CirclePlus },
  { href: "/portfolio", label: "Portfolio", icon: WalletCards },
  { href: "/security", label: "Security", icon: ShieldCheck },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/markets" && pathname.startsWith("/market/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMarketDetail = /^\/market\/[^/]+\/[^/]+/.test(pathname);
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="topbar">
        <div className="nav-wrap">
          <Logo />
          <div className="topbar-context" aria-label="Network status">
            <span><i /> Base</span>
            <small>Connected markets</small>
          </div>
          <nav className={open ? "main-nav open" : "main-nav"} aria-label="Primary navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={isActive(pathname, link.href) ? "active" : undefined}
                onClick={() => setOpen(false)}
              >
                <link.icon aria-hidden="true" />
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
      <div className="app-frame">
        <aside className="tool-rail" aria-label="Workspace navigation">
          {links.map((link) => (
            <Link
              aria-label={link.label}
              className={isActive(pathname, link.href) ? "active" : undefined}
              href={link.href}
              key={link.href}
              title={link.label}
            >
              <link.icon aria-hidden="true" />
            </Link>
          ))}
        </aside>
        <main className={isMarketDetail ? "app-content market-detail-shell" : "app-content"}>{children}</main>
      </div>
    </>
  );
}
