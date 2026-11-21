import type { Metadata } from "next";
import "@lilco/ui/tokens.css";
import "@lilco/ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "lilboard — Agent workboard",
  description: "A workboard for agent messages and tasks.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
