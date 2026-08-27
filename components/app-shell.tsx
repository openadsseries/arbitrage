"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CirclePlus,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);

  useEffect(() => {
    function collapseRail(event: KeyboardEvent) {
      if (event.key === "Escape") setRailExpanded(false);
    }

    window.addEventListener("keydown", collapseRail);
    return () => window.removeEventListener("keydown", collapseRail);
  }, []);

  return (
    <>
      <header className={railExpanded ? "topbar rail-expanded" : "topbar"}>
        <div className="nav-wrap">
          <Logo />
          <div className="topbar-context" aria-label="Network status">
            <span><i /> Base</span>
            <small>Connected markets</small>
          </div>
          <nav className={mobileOpen ? "main-nav open" : "main-nav"} aria-label="Primary navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={isActive(pathname, link.href) ? "active" : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <link.icon aria-hidden="true" />
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="nav-actions">
            <WalletButton />
            <button
              className="menu-toggle"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <div className={railExpanded ? "app-frame rail-expanded" : "app-frame"}>
        <aside
          className={railExpanded ? "tool-rail rail-expanded" : "tool-rail"}
          id="workspace-navigation"
          aria-label="Workspace navigation"
        >
          <button
            className="tool-rail-toggle"
            type="button"
            onClick={() => setRailExpanded((expanded) => !expanded)}
            aria-label={railExpanded ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={railExpanded}
            aria-controls="workspace-navigation"
            title={railExpanded ? "Collapse navigation" : "Expand navigation"}
          >
            {railExpanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
            <span>Navigation</span>
          </button>
          {links.map((link) => (
            <Link
              aria-label={link.label}
              className={isActive(pathname, link.href) ? "active" : undefined}
              href={link.href}
              key={link.href}
              title={link.label}
            >
              <link.icon aria-hidden="true" />
              <span>{link.label}</span>
            </Link>
          ))}
        </aside>
        <main className={isMarketDetail ? "app-content market-detail-shell" : "app-content"}>{children}</main>
      </div>
    </>
  );
}
