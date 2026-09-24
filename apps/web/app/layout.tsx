import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Futures Intelligence Dashboard",
  description: "Position structure research dashboard for futures traders.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="dark">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
