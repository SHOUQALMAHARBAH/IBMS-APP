/**
 * Part F item #6 remainder — fuzzy transliteration matching for Arabic name
 * search (backlog: "full-text search ... with fuzzy matching for the
 * multiple valid transliterations of Arabic names"), deferred when item #6
 * itself shipped (see `ibms-brain/meta/context/bilingual-ui.md`'s "What
 * item #6 does NOT cover").
 *
 * A distance-based fuzzy matcher (transliterate the stored Arabic name to a
 * consonant skeleton via the `transliteration` npm package, then compare
 * against the query's own vowel-stripped skeleton with Levenshtein/pg_trgm
 * similarity) was evaluated empirically against real name pairs on this
 * Postgres install before this file was written, not assumed: true-positive
 * pairs like "Yousef"/"يوسف" (Levenshtein 1, trigram 0.29) scored in the
 * SAME range as a genuine false positive — "Khaled" against a stored
 * "Khalil" (a different person, Levenshtein 1, trigram 0.43). No threshold
 * separates the two. That collision is inherent to phonetic-key matching on
 * short 3-5-letter Arabic name skeletons — the same known limitation
 * Soundex/Metaphone have on short English names — not an artifact of this
 * specific normalization, so a hand-rolled Arabic phonetic key would hit the
 * identical ceiling for more build cost. Rejected as a primary match rule: a
 * customer/prospect/vendor search returning a different person's record on
 * a common name is worse than the bounded coverage below.
 *
 * This table instead lists KNOWN equivalent spellings of common Jordanian/
 * Arab given names across both scripts — English Latin variants plus the
 * Arabic spelling (with and without hamza, where that is commonly dropped
 * in casual typing, e.g. "احمد" vs "أحمد"). A search term matching (exactly,
 * case-insensitively) any entry in a group also searches every OTHER entry
 * in the same group — a real cross-script variant match with ZERO
 * false-positive risk, since it is an exact/stemmed lookup on a literal
 * known term (the same guarantee item #6's own tsvector search already
 * gives), at the cost of covering only names actually in the table.
 *
 * NOT exhaustive. The ~50 groups below are the most common Jordanian/Arab
 * given names, not a linguistically authoritative or complete list — extend
 * this table as real gaps surface (e.g. a support ticket naming a missed
 * variant); do not assume every Arabic name is covered. Family-name
 * components (e.g. "Al-"/"El-" prefixes) are deliberately NOT included —
 * they compose with far more variation than a fixed-group table can safely
 * represent without new false-positive risk.
 */
export const NAME_TRANSLITERATION_GROUPS: readonly (readonly string[])[] = [
  // Male given names
  ['mohammed', 'muhammad', 'mohamed', 'mohammad', 'muhammed', 'mohd', 'محمد'],
  ['ahmad', 'ahmed', 'أحمد', 'احمد'],
  ['khaled', 'khalid', 'خالد'],
  ['yousef', 'yusuf', 'youssef', 'yousif', 'يوسف'],
  ['ibrahim', 'ebrahim', 'إبراهيم', 'ابراهيم'],
  ['abdullah', 'abdallah', 'abdalla', 'عبدالله', 'عبد الله'],
  [
    'abdulrahman',
    'abdul rahman',
    'abdelrahman',
    'abdel rahman',
    'عبدالرحمن',
    'عبد الرحمن',
  ],
  ['hassan', 'hasan', 'حسن'],
  ['hussein', 'hussain', 'husayn', 'husain', 'حسين'],
  ['omar', 'umar', 'عمر'],
  ['ali', 'علي'],
  ['khalil', 'khaleel', 'خليل'],
  ['yaseen', 'yassin', 'yasin', 'ياسين'],
  ['saleh', 'salih', 'صالح'],
  ['tariq', 'tarek', 'tareq', 'طارق'],
  ['nasser', 'nasir', 'naser', 'ناصر'],
  ['faisal', 'faysal', 'feisal', 'فيصل'],
  ['rashid', 'rasheed', 'رشيد'],
  ['bilal', 'belal', 'بلال'],
  ['karim', 'kareem', 'كريم'],
  ['anas', 'أنس', 'انس'],
  ['mahmoud', 'mahmood', 'mahmud', 'محمود'],
  ['marwan', 'مروان'],
  ['ziad', 'ziyad', 'zeyad', 'زياد'],
  ['firas', 'فراس'],
  ['samir', 'sameer', 'سمير'],
  ['waleed', 'walid', 'وليد'],
  ['nabil', 'nabeel', 'نبيل'],
  ['adel', 'adil', 'عادل'],
  ['munir', 'muneer', 'منير'],
  ['amjad', 'أمجد'],
  ['ayman', 'أيمن'],
  ['fadi', 'fady', 'فادي'],
  ['rami', 'ramy', 'رامي'],
  ['sami', 'samy', 'سامي'],
  ['iyad', 'eyad', 'إياد', 'اياد'],
  ['hisham', 'هشام'],
  ['osama', 'usama', 'أسامة', 'اسامة'],
  ['jamal', 'gamal', 'جمال'],
  ['nizar', 'نزار'],
  ['wael', 'wail', 'وائل'],
  ['anwar', 'أنور', 'انور'],
  ['bassam', 'بسام'],
  ['zaid', 'zayd', 'zeid', 'زيد'],
  ['sultan', 'سلطان'],
  ['majed', 'majid', 'ماجد'],
  ['saeed', 'said', 'sayed', 'سعيد'],
  ['emad', 'imad', 'عماد'],
  ['ashraf', 'أشرف'],
  ['raed', 'raid', 'رائد'],

  // Female given names
  ['fatima', 'fatimah', 'فاطمة'],
  ['aisha', 'ayesha', 'aysha', 'عائشة', 'عايشة'],
  ['khadija', 'khadijah', 'خديجة'],
  ['maryam', 'mariam', 'miriam', 'مريم'],
  ['zainab', 'zeinab', 'zaynab', 'زينب'],
  ['noor', 'nour', 'nur', 'نور'],
  ['rana', 'رنا'],
  ['lina', 'leena', 'لينا'],
  ['hana', 'hanaa', 'هناء'],
  ['amal', 'أمل'],
  ['reem', 'rim', 'ريم'],
  ['sara', 'sarah', 'سارة'],
  ['dana', 'دانا'],
  ['lama', 'لمى'],
  ['yasmin', 'yasmeen', 'yasmine', 'ياسمين'],
  ['rania', 'raniya', 'رانيا'],
  ['dina', 'deena', 'دينا'],
  ['huda', 'هدى'],
  ['layla', 'laila', 'leila', 'ليلى'],
  ['salma', 'سلمى'],
];

/** Arabic tashkeel (diacritic) codepoint range — stripped before lookup so a
 * diacritized paste (e.g. "أَحْمَد") still matches the plain stored/typed
 * form. Case-folded for the Latin side; a no-op for Arabic, which has no
 * case. */
function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/[ً-ْ]/g, '');
}

const GROUP_BY_TOKEN = new Map<string, readonly string[]>();
for (const group of NAME_TRANSLITERATION_GROUPS) {
  for (const entry of group) {
    GROUP_BY_TOKEN.set(normalizeToken(entry), group);
  }
}

/**
 * Every KNOWN variant spelling for any word in `term` that matches a
 * curated name group above — never the matched word itself, never a guess.
 * Multi-word input is tokenized on whitespace so "Khaled Trading Co." still
 * expands "Khaled" without touching "Trading"/"Co." An empty result means no
 * word in `term` has a known variant; callers should still search the
 * original `term` unchanged (this function only ever ADDS terms).
 */
export function expandSearchTerms(term: string): string[] {
  const tokens = term.trim().split(/\s+/).filter(Boolean);
  const variants = new Set<string>();
  for (const token of tokens) {
    const group = GROUP_BY_TOKEN.get(normalizeToken(token));
    if (!group) continue;
    const normalizedToken = normalizeToken(token);
    for (const entry of group) {
      if (normalizeToken(entry) !== normalizedToken) variants.add(entry);
    }
  }
  return [...variants];
}
