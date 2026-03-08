import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ustadex University Insights",
  description: "Define → Assign → Collect → Report → Ask",
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
