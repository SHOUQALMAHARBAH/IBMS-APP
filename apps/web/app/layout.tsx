import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "../lib/auth/auth-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IBMS",
  description: "Insurance Brokerage Management System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      // Browser extensions (e.g. tooltip/translation helpers) sometimes
      // inject attributes onto <html> before React hydrates (observed:
      // bbai-tooltip-injected="true") — that's a client-only DOM mutation
      // outside this app's control, not a real server/client mismatch.
      // Scoped to this element only; doesn't suppress hydration warnings
      // for anything else in the tree.
      suppressHydrationWarning
    >
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
