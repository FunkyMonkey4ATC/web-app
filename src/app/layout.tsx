import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ground Truth",
  description: "A second set of ears for the tower. Runway safety agent on one Dell Pro Max GB10.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
