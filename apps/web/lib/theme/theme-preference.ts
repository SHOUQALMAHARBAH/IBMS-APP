/*
 * The user's explicit theme choice, or the absence of one.
 *
 * Three states, two of them visible. "system" is not an option anyone picks —
 * it is where everybody starts, because it is how the app behaved before a
 * toggle existed, and nothing should silently opt a user out of their
 * operating system's setting. The stored value is simply ABSENT until the
 * first click.
 *
 * An external store rather than `useState`, for the reason recorded in
 * ./../../components/app/nav-open-groups.ts and hit twice on this branch:
 * reading localStorage in a `useState` initialiser is a hydration bug — the
 * server cannot see it, so the first client render disagrees with the server
 * HTML — and adopting it in a mount effect instead trips
 * `react-hooks/set-state-in-effect`, which this repo lints as an error.
 * `useSyncExternalStore` is the sanctioned third option: `getServerSnapshot`
 * renders the SSR default, `getSnapshot` takes over after hydration, and no
 * effect and no setState appear anywhere in the path.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'ibms.theme';

let cache: ThemePreference | null = null;
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    // Private mode, or storage disabled by policy. Following the OS is a
    // perfectly good answer and never worth an exception.
    return 'system';
  }
}

/** Cached because React calls this during render and requires the same value
 *  back when nothing has changed. */
export function getThemeSnapshot(): ThemePreference {
  cache ??= read();
  return cache;
}

/** What the server renders: no preference, so the CSS media query decides and
 *  SSR matches the first client paint for everyone who has never chosen. */
export function getThemeServerSnapshot(): ThemePreference {
  return 'system';
}

export function subscribeTheme(onChange: () => void): () => void {
  listeners.add(onChange);
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

export function setThemePreference(next: ThemePreference): void {
  cache = next;
  try {
    if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The theme still applies for this session; only persistence failed.
  }
  for (const listener of listeners) listener();
}

/**
 * Writes the choice onto <html>, which is what the CSS keys off.
 *
 * `system` REMOVES the attribute rather than setting a value: the media query
 * is guarded as `:root:not([data-theme="light"])`, so the absence of the
 * attribute is what lets the OS decide. Setting `data-theme="system"` would
 * leave the guard satisfied but is a value no selector matches, which works by
 * accident rather than by design.
 */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}
