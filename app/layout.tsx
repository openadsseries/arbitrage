import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { WalletProvider } from "@/components/wallet-provider";
import "./globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GETHYPED — Create connected Hyped Token pools",
  description: "Create and inspect Hyped Token pools backed by existing tokens.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${displayFont.variable} ${monoFont.variable}`} lang="en" data-scroll-behavior="smooth">
      <body><WalletProvider><AppShell>{children}</AppShell></WalletProvider></body>
    </html>
  );
}
