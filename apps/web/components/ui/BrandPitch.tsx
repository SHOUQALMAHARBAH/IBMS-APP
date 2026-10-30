'use client';

import { useLanguage } from '../../lib/i18n/language-context';
import { Icon, type IconName } from './Icon';

/*
 * THE BRAND PANEL'S PROSE — the owner's own brand pack, and the one place in this product that
 * says what WASEET 360 is.
 *
 * It did not exist during the pilot, and the register recorded why: the i18n tree holds no product
 * tagline to slice, so writing one would have been exactly the thing rule 8(d) forbids. The owner
 * answered it by pointing at her own brand pack — the Arabic and English flyers her designer
 * produced, and reference page B, which composes three of their capability lines into this panel.
 *
 * THE THREE CHIPS ARE NOT A SELECTION OF MINE. The flyer carries six capability headings; the
 * reference page picked these three, and she approved that page. The other three (end-to-end
 * automation, robust governance, regulator-ready reporting) are deliberately not here: three chips
 * on a sign-in panel is what fits before the panel starts competing with the form beside it.
 *
 * THE ICONS ARE THE FLYER'S OWN PAIRINGS — a clipboard-ish mark for the audit trail, the network
 * node for the insurer channel, a shield for privacy — rather than icons chosen here. The flyer
 * draws them beside the same three headings.
 */
const CHIPS: Array<{ key: 'authBrandChipAudit' | 'authBrandChipChannel' | 'authBrandChipPrivacy'; icon: IconName }> = [
  { key: 'authBrandChipAudit', icon: 'checklist' },
  { key: 'authBrandChipChannel', icon: 'network' },
  { key: 'authBrandChipPrivacy', icon: 'shield' },
];

export function BrandPitch() {
  const { t } = useLanguage();

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <p
        style={{
          margin: 0,
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--weight-bold)',
          lineHeight: 'var(--leading-tight)',
          /*
           * `--nav-ink`, not `--ink-primary`. This panel is one of the two surfaces in the product
           * that stays dark in BOTH themes, so its text comes from the same `--nav-*` pair as the
           * rail's. A ramp step or an ink token here would follow the theme and disappear into the
           * navy — which is the defect the pilot's screenshot caught on this very panel.
           */
          color: 'var(--nav-ink)',
          textWrap: 'balance',
        }}
      >
        {t('authBrandHeadline')}
      </p>

      <p
        style={{
          margin: 0,
          fontSize: 'var(--text-sm)',
          lineHeight: 'var(--leading-relaxed)',
          color: 'var(--nav-ink-muted)',
          maxWidth: '26rem',
        }}
      >
        {t('authBrandPitch')}
      </p>

      <ul
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {CHIPS.map((chip) => (
          <li
            key={chip.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              /*
               * A translucent white rather than a token: the panel's own ground is a gradient, so
               * a solid surface token would sit on it as a flat patch. This is the one place a
               * literal colour is correct — it is an alpha ON the gradient, not a colour CHOICE,
               * and there is no token for "a sixth of the surface above me".
               */
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: 'var(--radius-full)',
              padding: '0.25rem var(--space-2)',
              fontSize: 'var(--text-xs)',
              color: 'var(--nav-ink)',
            }}
          >
            <Icon name={chip.icon} size={12} style={{ color: 'var(--accent)' }} />
            {t(chip.key)}
          </li>
        ))}
      </ul>
    </div>
  );
}
