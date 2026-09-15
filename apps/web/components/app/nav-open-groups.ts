/*
 * Which sidebar groups the user has explicitly expanded or collapsed, kept
 * per device.
 *
 * An external store rather than `useState` plus a mount effect, and the two
 * reasons for that turn out to be the same reason.
 *
 * Reading localStorage in a `useState` initialiser is a hydration bug: the
 * server cannot see localStorage, so the first client render disagrees with
 * the server HTML and React throws the tree away. That exact failure was
 * fixed in LanguageProvider earlier on this branch.
 *
 * Adopting the stored value in a mount effect instead only trades it for a
 * different defect — `react-hooks/set-state-in-effect`, which this repo lints
 * as an error, and whose own message names the way out: "subscribe for
 * updates from some external system". localStorage IS an external system, and
 * `useSyncExternalStore` is how React reads one. `getServerSnapshot` supplies
 * the SSR default, `getSnapshot` takes over after hydration, and there is no
 * effect and no setState anywhere in the path.
 *
 * Only groups the user has ACTUALLY toggled are recorded. A group with no
 * decision falls back to whatever default the caller wants — the group holding
 * the current route — so a group added later is open when you are inside it
 * rather than inheriting a stale `false` from a set written months ago.
 */

export type NavGroupDecisions = Readonly<Record<string, boolean>>;

const STORAGE_KEY = 'ibms.nav.openGroups';

/** Shared empty value, so repeated calls keep a stable reference. */
const NONE: NavGroupDecisions = {};

let cache: NavGroupDecisions | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): NavGroupDecisions {
  if (!raw) return NONE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return NONE;
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      // Anything else was hand-edited or written by an older shape; drop it
      // rather than letting a truthy string decide whether a group is open.
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return NONE;
  }
}

function read(): NavGroupDecisions {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private mode, or storage disabled by policy. A collapsed sidebar is
    // never worth an exception.
    return NONE;
  }
}

/**
 * The client snapshot. Cached because React calls this during render and
 * requires the same reference back when nothing has changed — returning a
 * fresh object each time is an infinite re-render.
 */
export function getNavGroupSnapshot(): NavGroupDecisions {
  cache ??= read();
  return cache;
}

/** What the server renders: no decisions, so the caller's default applies. */
export function getNavGroupServerSnapshot(): NavGroupDecisions {
  return NONE;
}

export function subscribeNavGroups(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` fires for OTHER tabs only, which is exactly the case a local
  // write cannot cover. A null key means the whole store was cleared.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cache = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Records a user decision and notifies every subscriber in this tab. */
export function setNavGroupOpen(key: string, open: boolean): void {
  cache = { ...getNavGroupSnapshot(), [key]: open };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // The group still expands for this session; only persistence failed.
  }
  for (const listener of listeners) listener();
}

/** Test seam — drops the cached snapshot so the next read hits storage. */
export function resetNavGroupCacheForTests(): void {
  cache = null;
}
