'use client';

import { PASSWORD_RULES, type PasswordRuleId } from '@ibms/db/password-policy';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';

/*
 * Live feedback on the password policy, shared by the mandatory first change
 * and the self-service one.
 *
 * The RULES come from `@ibms/db/password-policy` — the same module the API's
 * `PasswordService.assertMeetsPolicy` and the database seed both use, so there
 * is exactly one definition of what a valid password is and this cannot drift
 * below what login will accept.
 *
 * The WORDS do not come from there. That module returns English prose, which
 * is correct for the API (it goes straight into the 422 body) and wrong here,
 * where the same screen renders in Arabic for most of this system's users. So
 * the rule's `id` is the join, and the wording lives in the dictionary like
 * every other string in the app.
 *
 * One rule is deliberately absent: password history. The last five hashes are
 * on the server and nothing here can check them, so reuse is reported by the
 * API on submit — see the error surfaced by the calling screen.
 */

const RULE_LABEL_KEY: Record<PasswordRuleId, TranslationKey> = {
  minLength: 'pwRuleMinLength',
  maxBytes: 'pwRuleMaxBytes',
  lowercase: 'pwRuleLowercase',
  uppercase: 'pwRuleUppercase',
  digit: 'pwRuleDigit',
  symbol: 'pwRuleSymbol',
};

/** True when every rule this component can see is satisfied. The server still
 *  re-validates; this only decides whether to keep the submit button live. */
export function meetsPasswordPolicy(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.satisfiedBy(password));
}

export function PasswordRequirements({ password }: { password: string }) {
  const { t } = useLanguage();

  return (
    <ul
      aria-label={t('pwRequirementsLabel')}
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 'var(--space-2) 0 0',
        display: 'grid',
        gap: 'var(--space-1)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {PASSWORD_RULES.map((rule) => {
        // An empty box shows nothing as met, even though "at most 72 bytes"
        // is trivially true of the empty string: a green tick against a field
        // the user has not typed in yet reads as credit they have not earned.
        const met = password.length > 0 && rule.satisfiedBy(password);
        return (
          <li
            key={rule.id}
            /* State is carried in the TEXT, not only in the colour and the
               glyph: "met"/"not met" is read out, so this works for a screen
               reader and for anyone who cannot distinguish the two colours.
               Both halves come from the same dictionary, so they are never in
               different languages. */
            aria-label={`${t(RULE_LABEL_KEY[rule.id])} — ${met ? t('pwRuleMet') : t('pwRuleUnmet')}`}
            style={{
              // --ink-secondary (6.09:1 on a card) rather than opacity, which
              // composites to a colour no token declares and which the a11y
              // suite has already caught once on this branch.
              color: met ? 'var(--success-ink)' : 'var(--ink-secondary)',
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'baseline',
            }}
          >
            <span aria-hidden="true">{met ? '✓' : '○'}</span>
            <span>{t(RULE_LABEL_KEY[rule.id])}</span>
          </li>
        );
      })}
    </ul>
  );
}
