/**
 * Regenerates `docs/permission-catalogue-for-descriptions.txt` — the OWNER'S INPUT FILE for the
 * Arabic one-line permission descriptions.
 *
 * This is the I/O shell: it reads the seeded catalogue, hands it to
 * `apps/web/lib/admin/permission-descriptions-input.ts`, and writes or checks the file. Every
 * decision about the file's SHAPE lives there, with its tests — see that module's header for why the
 * split exists (the docker build is what found it) and for the two defects this generator had.
 *
 * `--check` writes nothing and exits non-zero when the file does not match the catalogue, naming any
 * Arabic line a regenerate would DESTROY. Never run the write variant after seeing that message.
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
    const written = harvestExistingArabic(existing);
    const content = render(catalogue, written);
    const carried = catalogue.filter((p) => written[p.code] !== undefined).length;

    if (CHECK_ONLY) {
      if (existing !== content) {
        // A written line that would not survive the regenerate. "Stale" is routine; "regenerating
        // would delete her work" is not, and the two must not print the same sentence.
        //
        // THIS DELIBERATELY DOES NOT ASK `harvestExistingArabic`. The first version did, and the
        // message was then unreachable in the one case that matters most: break the harvest and it
        // returns nothing, so there is nothing it can report as dropped — the worst failure printed
        // the mildest message. Proven by planting exactly that. A safety check may not be built out
        // of the component whose failure it exists to catch, so this reads the file directly.
        const dropped = writtenLinesIn(existing).filter((line) => !content.includes(line));
        console.error(
          `permission-descriptions input: STALE — ${OUT} does not match the seeded catalogue (${catalogue.length} codes).`,
        );
        if (dropped.length > 0) {
          console.error(
            `  AND regenerating would DROP ${dropped.length} Arabic line(s) somebody wrote. Fix the harvest before regenerating — do NOT run the write variant. First dropped: ${dropped[0]}`,
          );
        }
        console.error('  Regenerate it:  npm run db:permission-descriptions');
        process.exitCode = 1;
        return;
      }
      console.log(
        `permission-descriptions input: up to date (${catalogue.length} codes, ${carried} Arabic line(s) written).`,
      );
      return;
    }

    writeFileSync(OUT, content, 'utf8');
    console.log(
      `permission-descriptions input: wrote ${OUT} (${catalogue.length} codes, ${carried} Arabic line(s) carried forward).`,
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
