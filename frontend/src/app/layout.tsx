import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LedgerSnap — PDF to CSV in One Click",
  description:
    "Drop a folder of mixed PDF invoices, get a clean CSV. No templates, no training.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
