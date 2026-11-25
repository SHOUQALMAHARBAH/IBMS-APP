'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import { ActionStatus } from './ActionStatus';

/*
 * 🔴 OWNER DECISION 164 RULING 1 — A SMALL SELF-DISMISSING CONFIRMATION, AND IT IS THE FIRST ONE.
 *
 * Her words, of the message after «إنشاء الدور»: «بتطلع زي بوب أب صغيرة شكلها متناسق مع الشاشة و
 * فيها صح أخضر» — it appears like a small pop-up, its look matching the screen, with a green
 * check. And her ruling: «لا تمنع الشاشة ولا تحتاج كبسة … وتختفي وحدها» — it does not block the
 * screen, needs no press, and disappears by itself.
 *
 * ## WHAT THE PRODUCT ALREADY SHIPPED, MEASURED, AND WHY THIS IS STILL NEW
 *
 * Nothing here was a toast. The two nearest:
 *
 *   `ActionStatus`  the shipped «what an act is doing and what it did» component — inline `<p>`,
 *                   `role="status"`, three states with a stated precedence, on the design tokens.
 *                   It does not float, carries no icon, and never dismisses itself.
 *   `savedMessage`  this pattern on `/settings/roles` itself: a bare `<p role="status">` under
 *                   the form, which stays until the next act replaces it.
 *
 * A repo-wide search for a self-dismissing message found **no `setTimeout` anywhere in `app/` or
 * `components/` that hides a message** — the only three are a post-reset redirect and two
 * `EntitySearch` internals. So the dismissal, the floating position and the check mark genuinely
 * did not exist, and building them is what her ruling asks for.
 *
 * ## ⛔ IT DOES NOT RE-IMPLEMENT `ActionStatus`, IT COMPOSES IT
 *
 * What must not drift across the 90-odd sites that report an outcome is the ARIA role and the
 * tone, and `ActionStatus` owns both. So the TEXT is rendered through it with `outcome=`, which
 * is the semantically correct slot — «what the act DID» — and this component owns only the three
 * things that are new: where it sits, the check, and when it goes.
 *
 * ⟶ One home for `role="status"`. A second `role="status"` here, wrapping one from
 *   `ActionStatus`, would announce the same sentence twice to a screen reader.
 *
 * ## WHY IT IS NOT A PORTAL, AND WHY THAT IS SAFE
 *
 * `position: fixed` takes it out of flow and pins it to the viewport, so it needs no portal to
 * float above the form. ⛔ No `document.body` mounting, which would be the one thing in this
 * repository rendering outside the app shell.
 *
 * ⚠️ AND THERE ARE NO `--z-*` TOKENS — measured, not assumed: `globals.css` defines none, and the
 * four layers in the app are hand-written numbers. The first version of this comment claimed a
 * token scale existed. The real scale, measured across `app/` and `components/`: **20** (two
 * sites), **30**, **40** (`NotificationBell`'s dropdown) and **9999** (`IdleLockOverlay`, which
 * must cover everything). `60` sits above the bell and far below the idle lock, which is right
 * on both counts — a confirmation must not hide under an open menu, and it must never sit over
 * a screen lock.
 *
 * ## ⚠️ THE TIMER IS KEYED ON THE MESSAGE, NOT ON MOUNT
 *
 * Two roles created in a row send the same text twice. A timer that only ran on mount would
 * leave the second confirmation on screen forever, because the component never unmounted. The
 * effect depends on a monotonic token the caller bumps, so every call restarts the clock — and
 * `clearTimeout` on cleanup means two quick acts cannot leave a stale timer to hide the newer
 * message early.
 */

/** How long it stays. Long enough to read a short sentence twice, short enough not to sit over
 *  the next act. ⚠️ `prefers-reduced-motion` is irrelevant here — there is no motion to reduce;
 *  it appears and disappears without a transition, deliberately, because an animation on a
 *  confirmation is the thing a screen reader user gets nothing from and a slow machine janks. */
export const TOAST_DISMISS_MS = 5000;

const WRAPPER: CSSProperties = {
  position: 'fixed',
  // Bottom-centre: out of the way of both the header's language switch and the RTL/LTR sidebar,
  // so the one position is right in both directions without a per-direction rule.
  bottom: 'var(--space-5)',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  maxWidth: 'min(90vw, 28rem)',
  padding: 'var(--space-2) var(--space-4)',
  // Her «شكلها متناسق مع الشاشة» — the design tokens, and the SUCCESS trio specifically, which
  // already carries a light and a dark value (`globals.css`). ⛔ No literal green.
  background: 'var(--success-bg)',
  color: 'var(--success-ink)',
  border: '1px solid var(--success-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
};

const TEXT: CSSProperties = {
  // ⛔ Overrides `ActionStatus`'s own top margin and muted colour: inside a toast there is nothing
  // above to space from, and the colour is the success ink the wrapper sets.
  margin: 0,
  color: 'inherit',
};

/** Every `components/ui` primitive forwards these — `test/data-attributes.test.ts` is the guard,
 *  and its own message says why: a hook put on one that does not forward «type-checks and goes
 *  nowhere». It refused the first version of this file. */
type DataAttributes = { [key: `data-${string}`]: string | undefined };

export function Toast({
  message,
  /** Bumped by the caller on every act, so a repeat of the same text restarts the clock. */
  token,
  onDismiss,
  testId = 'toast',
  ...dataAttributes
}: {
  message: string | null;
  token: number;
  onDismiss: () => void;
  testId?: string;
} & DataAttributes) {
  /*
   * 🔴 VISIBILITY IS DERIVED, NOT STORED, AND A LINT RULE IS WHY.
   *
   * The first version held a `visible` boolean and set it inside the effect body — which
   * `react-hooks/set-state-in-effect` failed by name, rightly: a `setState` in an effect body is
   * a cascading render, and here it was redundant anyway. `message` being present IS the show
   * condition; the only thing state is needed for is the HIDE after the timer.
   *
   * So what is stored is WHICH TOKEN has already been dismissed, and `setState` happens only in
   * the timer callback — which is not the effect body. One piece of state, no cascade.
   *
   * ⚠️ The contract that makes this correct: the caller bumps `token` on every act. Re-setting
   * the SAME token after it has been dismissed would stay hidden, which is why the token is a
   * required prop rather than something this component derives from the message.
   */
  const [dismissedToken, setDismissedToken] = useState<number | null>(null);
  /*
   * The callback is read through a ref so a caller passing an inline arrow does not restart the
   * timer on every render — which would make a toast that never dismisses while the page is busy.
   *
   * ⚠️ AND THE REF IS UPDATED IN ITS OWN EFFECT, NOT DURING RENDER. `react-hooks/refs` failed
   * the plain `dismiss.current = onDismiss` assignment by name — «Cannot update ref during
   * render» — and it is right: a ref written during render makes the component's output depend
   * on a value React is free to discard. This is the documented latest-callback pattern.
   */
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message) return;
    const handle = setTimeout(() => {
      setDismissedToken(token);
      dismiss.current();
    }, TOAST_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [message, token]);

  if (!message || dismissedToken === token) return null;

  return (
    <div style={WRAPPER} data-testid={testId} {...dataAttributes}>
      {/* ⚠️ `Icon` IS ALREADY `aria-hidden="true"` AND ALREADY `flex: none`, BOTH BY ITS OWN
          DESIGN — read off `Icon.tsx`, whose header says why in as many words: «an icon never
          carries meaning alone». Its props are `name`, `size` and `style` and nothing else, so
          passing `aria-hidden` here would not even compile, and a `flexShrink` would restate
          what it already sets. The sentence beside it is what gets announced. */}
      <Icon name="check" />
      {/* The announcement itself, through the component that owns `role="status"`. `outcome` is
          the correct slot: this is what the act DID. */}
      <ActionStatus outcome={message} testId={testId} style={TEXT} />
    </div>
  );
}
