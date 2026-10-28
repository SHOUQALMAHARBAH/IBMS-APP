'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../lib/auth/auth-context';
import { hasAnyPermission } from '../../lib/auth/permissions';
import { useLanguage } from '../../lib/i18n/language-context';
import { BrandLockup, Icon, type IconName } from '../ui';
import { foldedIncludes, foldForSearch } from '../../lib/i18n/fold';
import type { TranslationKey } from '../../lib/i18n/translations';
import {
  canReach,
  DEFAULT_NAV_ORDER,
  DESTINATION_GROUPS,
  HOME,
  NAV_ORDER_BY_ROLE,
  SECURITY,
  type Destination,
  type RoleNavOrder,
} from './destinations';
import { TextInput } from '../ui/Field';
import {
  getNavGroupServerSnapshot,
  getNavGroupSnapshot,
  setNavGroupOpen,
  subscribeNavGroups,
} from './nav-open-groups';
import {
  navGroupItemsStyle,
  navGroupSummaryStyle,
  navLinkActiveStyle,
  navLinkStyle,
  navSearchInputStyle,
  navSearchStatusStyle,
  navSearchWrapStyle,
  brandStyle,
  navLinkLabelStyle,
  sidebarFooterStyle,
  sidebarStyle,
} from './app.styles';

/*
 * The primary navigation.
 *
 * Every item names the permission its own destination endpoint enforces, and
 * an item the signed-in user does not hold is NOT RENDERED. This is frontend
 * directive section 1 and MULTI-TENANCY-SPEC 10.4: if a role cannot do
 * something, the control does not exist on their screen — never render it and
 * let the page explain a 403 afterwards.
 *
 * That "render it and let the page 403" pattern is what this file used to do,
 * deliberately, with a comment saying a nav-level grid "would only duplicate
 * — and drift from — the seeded grid". The drift concern was real; the
 * conclusion was wrong. The fix is not to skip the check, it is to stop
 * hand-maintaining a second copy of the grid: user.permissions is the
 * server's OWN resolved set, returned by /auth/me from the same grid the API
 * enforces with, so there is nothing here to drift.
 *
 * The permission codes below were derived mechanically, not guessed — each is
 * what RequirePermissions on that route's own GET handler asks for.
 *
 * Two items carry NO permission and are always visible:
 *   - Home, which is a launcher and holds nothing privileged.
 *   - Security (in the footer), which is SELF-SERVICE MFA enrolment. It must
 *     never be gated: MfaRequiredGuard 403s every other screen until a user
 *     enrols, so hiding the one route that lets them enrol would lock out
 *     every role that does not hold the admin security-config.read — which is
 *     ten of the eleven.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GROUPS LOOK LIKE THIS
 * ---------------------------------------------------------------------------
 * A broadly-permissioned role reaches a lot of this: a Branch/Department
 * Manager sees 43 of the 68 gated items, an Executive 36. Before this pass all
 * of them rendered at once, and two groups carried 25 of the Manager's 43 —
 * so the rail always scrolled and the header rows did no real work.
 *
 * Three structural edits, taken from the reviewed plan:
 *   - "Sales & clients" (13, the largest) split into New business / Clients /
 *     Policies. It was mixing three different jobs: winning work, servicing an
 *     existing book, and the policies themselves.
 *   - "Insights & reporting" (14) split into Dashboards / Performance &
 *     analysis — a screen you watch versus a question you go and answer.
 *   - "Claims" held exactly one item, an analytics screen, with no operational
 *     claims screen to sit beside. Dissolved into Performance & analysis.
 *
 * ONE taxonomy, filtered per role — never a per-role tree. A user holding two
 * roles still gets one coherent sidebar, and there is no second structure to
 * drift from the grid. What varies per role is ORDER; see
 * NAV_ORDER_BY_ROLE.
 *
 * Item order inside the six groups this pass did not restructure is left
 * exactly as it was, deliberately: re-sequencing groups nobody asked about
 * would bury the change that was actually reviewed.
 *
 * Deliberately NOT in scope here, and still open: directive section 5 wants a
 * sidebar of "major modules only", and 43 grouped entries are still 43
 * entries. Collapsing makes the rail usable; it does not make it short. The
 * prune that would — folding KYC queue into Customers, consolidating the
 * performance screens — moves PAGES, needs client sign-off on what merges, and
 * is tracked as a separate pass. See README section Known gaps.
 */


function matches(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

/** The first role THIS MAP declares that the user actually holds — so the
 *  result does not depend on the order /auth/me happens to return roles in.
 *  Anyone the map does not name gets `DEFAULT_NAV_ORDER`, which is the same
 *  sequence a Manager sees; nobody falls through to the declaration order. */
function navOrderFor(roles: readonly string[] | undefined): RoleNavOrder {
  if (roles?.length) {
    for (const [role, order] of Object.entries(NAV_ORDER_BY_ROLE)) {
      if (roles.includes(role)) return order;
    }
  }
  return DEFAULT_NAV_ORDER;
}

/** Position in `order`, or the end for anything the list does not name.
 *  Paired with a stable sort, so unnamed entries keep their relative order. */
function rankIn(order: readonly string[], value: string): number {
  const i = order.indexOf(value);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export function AppNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { t, tPlural, language } = useLanguage();

  /* The office's own name, resolved at render by the reader's language — see the note at the
   * brand lockup below. */
  const organizationName =
    language === 'AR'
      ? (user?.organizationName?.ar ?? null)
      : (user?.organizationName?.en ?? null);

  const canSee = (item: Destination) => canReach(user, item);

  const permitted = DESTINATION_GROUPS.map((group) => ({
    labelKey: group.labelKey,
    // Carried through BOTH projections, here and in `shownGroups`. A group that loses its icon
    // on the way to the render is a group whose links quietly stop having one, which is the
    // half a careless version forgets because the compiler only names one of the two.
    icon: group.icon,
    items: group.items.filter(canSee),
  })).filter((group) => group.items.length > 0);

  const roleOrder = navOrderFor(user?.roles);
  // Array.prototype.sort is stable, so a group the order omits keeps its
  // declaration position relative to the other omitted ones, and an item no
  // `hoist` names keeps its global position relative to the other unhoisted
  // ones.
  const hoist = roleOrder?.hoist;
  const withHoistedItems =
    hoist && hoist.length > 0
      ? permitted.map((group) => ({
          labelKey: group.labelKey,
          icon: group.icon,
          items: [...group.items].sort((a, b) => rankIn(hoist, a.href) - rankIn(hoist, b.href)),
        }))
      : permitted;

  const visibleGroups = roleOrder
    ? [...withHoistedItems].sort(
        (a, b) => rankIn(roleOrder.groups, a.labelKey) - rankIn(roleOrder.groups, b.labelKey),
      )
    : withHoistedItems;

  // Longest matching href wins, so /customers/kyc-queue highlights "KYC
  // queue" only — not "Customers" as well. Computed over the VISIBLE set so a
  // hidden item can never claim the active state.
  const activeHref = [HOME, ...visibleGroups.flatMap((g) => g.items), SECURITY]
    .filter((item) => matches(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const activeGroupKey = visibleGroups.find((g) => g.items.some((i) => i.href === activeHref))?.labelKey;

  /*
   * Open/closed state, read from an external store rather than held in state.
   * See ./nav-open-groups.ts for why that is not a stylistic choice: a
   * `useState` initialiser reading localStorage is a hydration bug, and
   * adopting it in a mount effect is a lint error. The store's server snapshot
   * is empty, so SSR and the first client render agree, and the default below
   * applies until the user has actually toggled something.
   */
  const decisions = useSyncExternalStore(subscribeNavGroups, getNavGroupSnapshot, getNavGroupServerSnapshot);

  const [query, setQuery] = useState('');
  // Folded, so whitespace-only is not a search — see lib/i18n/fold.ts for why
  // a raw `includes()` is the wrong test in Arabic.
  const searching = foldForSearch(query).length > 0;

  const shownGroups = searching
    ? visibleGroups
        .map((group) => ({
          labelKey: group.labelKey,
          icon: group.icon,
          items: group.items.filter((item) => foldedIncludes(t(item.labelKey), query)),
        }))
        .filter((group) => group.items.length > 0)
    : visibleGroups;

  const matchCount = shownGroups.reduce((n, g) => n + g.items.length, 0);

  /*
   * EVERY LINK CARRIES AN ICON, and the icon comes from the GROUP unless the destination overrides
   * it — see the note on `DestinationGroup.icon` for why that is 11 decisions rather than 84.
   *
   * It is `aria-hidden` inside the link, so the accessible name is the label alone. An icon beside
   * its own words is the owner's flyer language; an icon that announces itself would have a screen
   * reader read every nav item twice.
   */
  function renderLink(item: Destination, groupIcon?: IconName) {
    const isActive = item.href === activeHref;
    const icon = item.icon ?? groupIcon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        style={isActive ? navLinkActiveStyle : navLinkStyle}
      >
        {icon ? <Icon name={icon} size={16} /> : null}
        <span style={navLinkLabelStyle}>{t(item.labelKey)}</span>
      </Link>
    );
  }

  return (
    <nav aria-label={t('navPrimaryAria')} style={sidebarStyle} data-app-rail>
      {/*
        THE BRAND, where the owner named it: *"where the shell names the application (the sidebar
        header, the login screen, the browser tab title)"*. The office's own name is its SUBTITLE
        rather than a second line in the top bar — one lockup, the arrangement the approved
        reference screen uses, and the organization reads as who you are signed in as rather than
        as somewhere to go.

        Resolved at RENDER by the reader's language, the same way the department is and for the
        same reason: the server sends both forms and the caller is the one that knows which script
        it is drawing. Picking server-side pins the language to whatever `me()` was fetched under.

        NOTHING renders for the subtitle when the field is absent. An organization name is the one
        string here a person reads as authoritative, so a placeholder would have the system assert
        something untrue about her employer.
      */}
      <Link href="/" style={brandStyle}>
        <BrandLockup
          subtitle={
            organizationName ? <bdi data-organization-name>{organizationName}</bdi> : undefined
          }
        />
      </Link>

      <div style={navSearchWrapStyle}>
        <TextInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
          placeholder={t('navSearchPlaceholder')}
          aria-label={t('navSearchLabel')}
          style={navSearchInputStyle}
        />
        {searching ? (
          <div style={navSearchStatusStyle} aria-live="polite">
            {matchCount > 0 ? tPlural('navSearchMatches', matchCount) : t('navSearchNoResults')}
          </div>
        ) : null}
      </div>

      {renderLink(HOME)}

      {shownGroups.map((group) => (
        <details
          key={group.labelKey}
          /* A query overrides collapse entirely: a match is never hidden
             behind a closed group. Not an accordion — opening one group does
             not close another, because a manager genuinely works across
             Clients and Finance in one sitting. */
          open={searching || (decisions[group.labelKey] ?? group.labelKey === activeGroupKey)}
          onToggle={(e) => {
            // While searching, `open` is driven by the query, and the toggle
            // events that come from it are not user intent — recording them
            // would overwrite the user's real preferences with search state.
            if (!searching) setNavGroupOpen(group.labelKey, e.currentTarget.open);
          }}
        >
          <summary style={navGroupSummaryStyle}>{t(group.labelKey)}</summary>
          <div style={navGroupItemsStyle}>
            {group.items.map((item) => renderLink(item, group.icon))}
          </div>
        </details>
      ))}

      {/*
        Identity and sign-out moved to the navbar's profile menu, which now
        shows the same name plus the department and owns the sign-out. Leaving
        a second copy here would be the duplicate-brand-mark problem again,
        one row down.

        The Security link stays. It is the SELF-SERVICE MFA enrolment route,
        deliberately ungated because MfaRequiredGuard 403s every other screen
        until a user enrols — and it is now reachable two ways, which for the
        one route that can strand a user is a feature rather than a duplicate.
      */}
      <div style={sidebarFooterStyle}>{renderLink(SECURITY, 'lock')}</div>
    </nav>
  );
}
