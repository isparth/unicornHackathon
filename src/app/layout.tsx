import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Job Intake & Booking Agent",
  description:
    "Milestone 1 skeleton for a database-backed home-service booking workflow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
