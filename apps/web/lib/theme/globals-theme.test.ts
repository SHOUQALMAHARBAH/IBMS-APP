import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The drift guard for the two dark-mode blocks in globals.css.
 *
 * Dark tokens are defined twice on purpose — once under the
 * prefers-color-scheme media query (the default, for users who have never
 * touched the toggle) and once under :root[data-theme="dark"] (the explicit
 * override). Collapsing them into one would mean `light-dark()`, which is
 * Baseline 2024 and a browser-floor bet this product should not take.
 *
 * The cost of that choice is that someone can edit one block and not the
 * other, and the symptom would be a token that is correct for OS-dark users
 * and wrong for anyone who pressed the button — a bug no screenshot of either
 * state alone would reveal. So it fails the build instead.
 */

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

function tokensIn(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    out.set(name, value.trim());
  }
  return out;
}

const mediaBlock = CSS.match(
  /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n {2}\}\n\}/,
);
const attributeBlock = CSS.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/);

describe('globals.css — the two dark-mode blocks', () => {
  it('both exist and are findable', () => {
    expect(mediaBlock, 'media-query dark block').not.toBeNull();
    expect(attributeBlock, '[data-theme="dark"] block').not.toBeNull();
  });

  it('define exactly the same set of custom properties', () => {
    const media = [...tokensIn(mediaBlock![1]).keys()].sort();
    const attribute = [...tokensIn(attributeBlock![1]).keys()].sort();
    expect(attribute).toEqual(media);
  });

  it('give every shared property the same value', () => {
    const media = tokensIn(mediaBlock![1]);
    const attribute = tokensIn(attributeBlock![1]);
    const differing = [...media.entries()]
      .filter(([name, value]) => attribute.get(name) !== value)
      .map(([name]) => name);
    expect(differing).toEqual([]);
  });

  it('is a real palette, not an empty match that would pass vacuously', () => {
    // If a refactor broke the regexes above, both sides would be empty and the
    // equality assertions would pass while guarding nothing.
    expect(tokensIn(mediaBlock![1]).size).toBeGreaterThan(20);
  });

  it('guards the media query so an explicit light choice beats a dark OS', () => {
    expect(CSS).toContain(':root:not([data-theme="light"])');
  });
});
