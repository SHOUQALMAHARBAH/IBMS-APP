import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "../lib/auth/auth-context";
import { LanguageProvider } from "../lib/i18n/language-context";
import { IdleLockOverlayHost } from "../components/auth/IdleLockOverlayHost";
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
        {/*
          Applies the stored theme BEFORE first paint.

          Without this the attribute is only set once React hydrates, so a user
          who chose dark gets a flash of the light palette on every page load —
          and the reverse for a light choice on a dark OS. The script is
          synchronous and deliberately tiny: read one key, set one attribute,
          swallow anything that throws (private mode, storage disabled).

          It writes NOTHING when no preference is stored, because the absence
          of the attribute is what lets the prefers-color-scheme media query
          decide — see the guard on that block in globals.css.

          Safe against hydration: <html> already carries
          suppressHydrationWarning for exactly this class of pre-hydration DOM
          mutation, and ThemeToggle re-applies the same value from the store
          once mounted.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('ibms.theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();",
          }}
        />
        <AuthProvider>
          <LanguageProvider>
            <IdleLockOverlayHost />
            {children}
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
