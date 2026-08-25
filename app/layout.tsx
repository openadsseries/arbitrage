import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { WalletProvider } from "@/components/wallet-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "GETHYPED — Create connected Hyped Token pools",
  description: "Create and inspect Hyped Token pools backed by existing tokens.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body><WalletProvider><AppShell>{children}</AppShell></WalletProvider></body>
    </html>
  );
}
