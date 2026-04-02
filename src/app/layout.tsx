import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/bottom-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chess Coach",
  description: "AI-powered coaching for your Chess.com games",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface text-gray-200 antialiased">
        <main className="pb-20">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
