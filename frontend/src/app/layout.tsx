import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VC KPI MIS",
  description: "University VC KPI Collection & HEC Reporting",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
