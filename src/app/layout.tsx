import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ProofLayer · Research, checked",
  description:
    "Independent paper reproduction with a traceable evidence logbook.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
