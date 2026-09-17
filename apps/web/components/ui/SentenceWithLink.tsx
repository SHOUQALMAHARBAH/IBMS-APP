'use client';

import type { CSSProperties, ReactNode } from 'react';

/*
 * A translated sentence with one inline link in it.
 *
 * Six screens say "No customer selected — open a customer from Customers and
 * <do the thing> from there", with the link in the middle of the sentence.
 * That cannot be one `t()` call, because `t()` substitutes strings and a
 * button is a React node; and it must not be split into a prefix key and a
 * suffix key, because the link does not sit in the same place in Arabic as it
 * does in English — a fixed prefix/suffix split hard-codes English word order
 * into every other language.
 *
 * So the translated value carries a `{link}` marker and this splits on it. The
 * translator moves the marker wherever the sentence needs it, and the link
 * follows.
 */

const linkStyle: CSSProperties = {
  // Matches the inline links this replaces: underlined text, no button chrome.
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
};

export function SentenceWithLink({
  sentence,
  linkLabel,
  onLinkClick,
}: {
  /** A translated string containing exactly one `{link}` marker. */
  sentence: string;
  linkLabel: string;
  onLinkClick: () => void;
}): ReactNode {
  const marker = sentence.indexOf('{link}');
  // A translation that lost its marker still renders as a readable sentence,
  // with the link appended rather than silently dropped.
  const before = marker === -1 ? sentence : sentence.slice(0, marker);
  const after = marker === -1 ? '' : sentence.slice(marker + '{link}'.length);

  return (
    <>
      {before}
      <button type="button" onClick={onLinkClick} style={linkStyle}>
        {linkLabel}
      </button>
      {after}
    </>
  );
}
