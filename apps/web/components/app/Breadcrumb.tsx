'use client';

import { usePathname } from 'next/navigation';
import { useLanguage } from '../../lib/i18n/language-context';
import { DESTINATION_GROUPS, HOME } from './destinations';
import { crumbCurrentStyle, crumbStyle } from './app.styles';

/*
 * WHERE YOU ARE — the group, then the screen.
 *
 * The approved reference screen's top bar reads «الالتزام والمخاطر ⟵ الحوادث», and that answers
 * §4(c)'s test directly: *can a person tell, without reading everything, where they are?* The rail
 * answers it too, by highlighting the active item — but the rail scrolls, and on a long nav a
 * reader three screens into Compliance may have the active item off-view.
 *
 * DERIVED FROM THE DESTINATION CATALOGUE, NEVER A PER-SCREEN PROP. A `<Breadcrumb group="…" />`
 * on each of 106 screens would be 106 strings free to disagree with the nav, and the first one to
 * drift would be a screen telling a reader it lives somewhere it does not. `destinations.ts` is
 * already the single home for "which group is this screen in" (its own header: *do not write a
 * second list*), so this reads it.
 *
 * THE LONGEST MATCHING HREF WINS, the same rule the rail's own active-item computation uses — and
 * for the same reason: `/customers/kyc-queue` must resolve to the KYC queue and not to Customers.
 * It is NOT computed over the permitted set, deliberately: the rail filters by `canReach` because
 * it OFFERS routes, while this only NAMES the screen the reader is already on, and a reader who
 * reached a screen can be told what it is called. Filtering here would leave a blank bar on any
 * screen reachable by a route the nav does not list — a detail page, for instance.
 *
 * It renders NOTHING on the home screen and nothing on a screen the catalogue does not list: a
 * breadcrumb that says "/" is noise, and inventing a label for an unlisted route is the thing that
 * makes a derived crumb start lying.
 */
export function Breadcrumb() {
  const pathname = usePathname();
  const { t } = useLanguage();

  if (!pathname || pathname === HOME.href) return null;

  const candidates = DESTINATION_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ group, item })),
  )
    .filter(
      ({ item }) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .sort((a, b) => b.item.href.length - a.item.href.length);

  const best = candidates[0];
  if (!best) return null;

  return (
    <span style={crumbStyle} data-breadcrumb>
      {t(best.group.labelKey)}
      {/* A plain separator rather than a chevron: the browser mirrors nothing here, and a
          directional glyph would point the wrong way in one of the two languages. */}
      {' · '}
      <span style={crumbCurrentStyle}>{t(best.item.labelKey)}</span>
    </span>
  );
}
