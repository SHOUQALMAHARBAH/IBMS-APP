import type { Metadata } from "next";
import { Geist_Mono, Tajawal } from "next/font/google";
import { AuthProvider } from "../lib/auth/auth-context";
import { LanguageProvider } from "../lib/i18n/language-context";
import { IdleLockOverlayHost } from "../components/auth/IdleLockOverlayHost";
import "./globals.css";

/*
 * TAJAWAL IS THE PRODUCT'S FACE — the owner's own choice, option 1 of the two she was shown on the
 * approved reference screen.
 *
 * `arabic` is listed FIRST in the subsets because Arabic is this product's first language: the
 * Arabic face is the one chosen for the UI and the Latin follows it, not the reverse.
 *
 * Weights 400/500/700, matching the reference page. Tajawal has NO 600, so `--weight-semibold`
 * resolves by the browser's own font-matching — for a desired 600 with 500 and 700 available, the
 * CSS Fonts algorithm checks weights above the target first and lands on 700. Stated rather than
 * discovered: a heading that reads bolder than its token says is not a bug here, it is the face
 * not having that weight.
 *
 * Geist is GONE as the UI face and `Geist_Mono` is kept, because four screens render machine text
 * (an audit entity id, a revealed identifier, a constraint name, an SLA key) in a monospace face
 * under its own label, and a proportional face there invites somebody to read a token as prose.
 */
const waseetSans = Tajawal({
  variable: "--font-waseet",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/*
 * THE PRODUCT IS CALLED WASEET 360. "IBMS" was the internal codename and must not appear anywhere
 * a person reads — this is the browser tab, which is one of the three places the owner named by
 * hand (the sidebar header, the sign-in screen, the tab title).
 *
 * Arabic first, then the Latin form, because that is the order the logo's own bilingual lockup
 * uses. The description is the product's own sentence rather than the codename's expansion.
 */
export const metadata: Metadata = {
  title: "وسيط 360 — WASEET 360",
  /*
   * ENGLISH ONLY, and that is a correction of my own: the first version of this line carried an
   * Arabic sentence I had composed, which this batch's rule forbids outright — no new Arabic word,
   * sliced from a shipping string or the owner's. Measured: the i18n tree holds NO product
   * tagline to slice (nine strings mention «المنصّة» and every one of them is about a specific
   * screen), so there is nothing to derive and the Arabic is hers to write. The TITLE keeps
   * «وسيط 360» because that is the product's NAME out of her own brand pack rather than prose.
   */
  description: "WASEET 360 — insurance brokerage management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${waseetSans.variable} ${geistMono.variable}`}
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
