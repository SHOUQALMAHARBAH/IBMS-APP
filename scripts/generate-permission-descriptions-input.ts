/**
 * Regenerates `docs/permission-catalogue-for-descriptions.txt` — a READ-ONLY MIRROR, for an owner
 * with no repository access, of the Arabic permission descriptions as the Role screen renders them.
 *
 * ## It used to be the input file, and is not any more
 *
 * It was the place the Arabic was WRITTEN, harvested back out of the file by code on each
 * regenerate. The owner delivered all 219 lines on 2026-09-30 and ruled that the descriptions live
 * in the dictionary with every other user-facing string — one home, no exemptions. This file then
 * had zero written lines in it and was still shaped as a place to write, which is a second home
 * waiting to be used: a line typed here would have been mirrored nowhere and dropped by the next
 * regenerate.
 *
 * So the ARABIC NOW COMES FROM THE DICTIONARY, and the harvest survives inverted — as a REFUSAL.
 * A non-blank `ar:` line here that is not the dictionary's line for that code is a line written in
 * the wrong home; both modes refuse, naming the code and the file it belongs in, and the write mode
 * refuses BEFORE writing. The property the harvest existed for is unchanged — her work is never
 * destroyed — but the mechanism now points at the single source instead of maintaining a second one.
 *
 * `--check` writes nothing and exits non-zero when the file does not match the catalogue plus the
 * dictionary.
 *
 * Usage:  npm run db:permission-descriptions
 *         npm run db:permission-descriptions:check
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  harvestExistingArabic,
  OUT,
  render,
  writtenLinesIn,
} from '../apps/web/lib/admin/permission-descriptions-input';
import { PERMISSIONS } from '../apps/web/lib/i18n/translations/permissions';
import { permissionDescriptionKey } from '../apps/web/lib/i18n/permission-key';

const DICTIONARY = 'apps/web/lib/i18n/translations/permissions.ts';

/** The Arabic line the Role screen renders for each code, keyed by code. The single source. */
function arabicFromDictionary(codes: readonly string[]): Record<string, string> {
  const ar = PERMISSIONS.AR as Record<string, string | undefined>;
  const out: Record<string, string> = {};
  for (const code of codes) {
    const line = ar[permissionDescriptionKey(code)];
    if (line !== undefined && line.trim().length > 0) out[code] = line.trim();
  }
  return out;
}

/**
 * Codes whose `ar:` line in the mirror is not the dictionary's line for that code.
 *
 * READS THE FILE, NOT THE DICTIONARY'S OPINION OF IT — the same reason `writtenLinesIn` exists
 * beside `harvestExistingArabic`: a safety check built out of the component whose failure it exists
 * to catch reports the mildest message in the worst case, which this generator has already been
 * bitten by once.
 */
function linesWrittenInTheWrongHome(
  existing: string,
  fromDictionary: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(harvestExistingArabic(existing))
    .filter(([code, line]) => line.trim().length > 0 && line.trim() !== fromDictionary[code])
    .map(([code, line]) => `${code}: ${line.trim()}`);
}

const CHECK_ONLY = process.argv.includes('--check');

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.permission.findMany({
      select: { code: true, module: true, description: true },
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
    if (rows.length === 0) {
      throw new Error(
        'The permission catalogue is empty. Run `npm run db:seed` — this file is a measurement of the seeded catalogue, and an empty one would hand her a document with nothing in it.',
      );
    }
    const catalogue = rows.map((p) => ({
      code: p.code,
      module: p.module,
      description: p.description ?? '',
    }));

    const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    const written = arabicFromDictionary(catalogue.map((p) => p.code));
    const content = render(catalogue, written);
    const mirrored = catalogue.filter((p) => written[p.code] !== undefined).length;

    // A LINE IN THE WRONG HOME, in BOTH modes and before any write. "Stale" is routine; "somebody
    // wrote a description in the mirror" is not, and the two must not print the same sentence —
    // regenerating over it would destroy reviewed work and report success.
    const misplaced = linesWrittenInTheWrongHome(existing, written);
    if (misplaced.length > 0) {
      console.error(
        `permission-descriptions: ${misplaced.length} Arabic line(s) are written in ${OUT}, which is a MIRROR and is not read by anything.`,
      );
      console.error(`  Move each one into ${DICTIONARY} under its \`perm:<code>\` key, then regenerate.`);
      console.error(`  First: ${misplaced[0]}`);
      process.exitCode = 1;
      return;
    }

    if (CHECK_ONLY) {
      if (existing !== content) {
        // Kept as a second, independent reading of the file — `writtenLinesIn` does not ask the
        // harvest, so a broken harvest cannot make this silent. That defect was real here once: the
        // worst failure printed the mildest message, proven by planting it.
        const dropped = writtenLinesIn(existing).filter((line) => !content.includes(line));
        console.error(
          `permission-descriptions mirror: STALE — ${OUT} does not match the seeded catalogue (${catalogue.length} codes) plus ${DICTIONARY}.`,
        );
        if (dropped.length > 0) {
          console.error(
            `  AND regenerating would DROP ${dropped.length} Arabic line(s) present in the file. First: ${dropped[0]}`,
          );
        }
        console.error('  Regenerate it:  npm run db:permission-descriptions');
        process.exitCode = 1;
        return;
      }
      console.log(
        `permission-descriptions mirror: up to date (${catalogue.length} codes, ${mirrored} Arabic line(s) from the dictionary).`,
      );
      return;
    }

    writeFileSync(OUT, content, 'utf8');
    console.log(
      `permission-descriptions mirror: wrote ${OUT} (${catalogue.length} codes, ${mirrored} Arabic line(s) from the dictionary).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Not run when imported by the spec.
if (process.argv[1] !== undefined && process.argv[1].includes('generate-permission-descriptions-input')) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
