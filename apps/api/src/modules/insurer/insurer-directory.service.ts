import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  InsurerDirectoryRepository,
  INSURER_DIRECTORY_COLUMNS,
  type DirectoryLineFilter,
  type InsurerDirectoryRow,
} from '../../repositories/insurer-directory.repository';
import { InsuranceLineRepository } from '../../repositories/insurance-line.repository';
import { pageWindow, type Paginated } from '../../common/pagination';
import type { ListInsurerDirectoryQueryDto } from './dto/insurer-directory.dto';

/**
 * The cross-office insurer directory — a read-only lead list.
 *
 * ## What it is for, and what it deliberately is not
 *
 * An office that needs cover for a risk nobody on its panel writes has, until now, had
 * to find out who does by asking around. The directory answers that from what offices
 * have already registered: the companies that exist, how to contact them, and what they
 * write.
 *
 * Everything after the search happens OUTSIDE the system. There is no contract request,
 * no follow-up workflow, no "we approached them on this date" record — by design, not
 * omission. The office finds a company and picks up the phone; the system's job ends at
 * the name and the number.
 *
 * ## The boundary is the schema, not this file
 *
 * These are competing brokerages. The company is public knowledge; the panel is not. So
 * the directory never shows which offices deal with a company, nor any office's
 * commercial terms — and the way that is guaranteed is that the SECURITY DEFINER view it
 * reads has no such column in it. This service maps the view's columns and cannot invent
 * one, `INSURER_DIRECTORY_COLUMNS` is the single list of what crosses, and two tests
 * assert it: one on this response, one on the view itself.
 *
 * So there is nothing to filter here, which is the point. A service that had to remember
 * to drop a credit term would be one refactor away from not dropping it.
 *
 * ## Searching BY LINE — what changed, and why the original objection is answered
 *
 * This shipped with name search only, and the DTO said so: "no filter by line … yet:
 * every additional filter is a place where a wrong default could hide a company that does
 * write the cover somebody needs." The objection was right about the risk and wrong about
 * the remedy, because the feature's whole justification is that an office should not have
 * to discover who writes a line by asking around — and without a line filter that is
 * exactly what it had to do. A read-only lead list you can only search by company name
 * answers "is this company on the platform", never "who writes this cover".
 *
 * The hiding risk is answered in three places rather than by leaving the filter out:
 *
 *  1. **There is no default.** No `lineCode` means no line predicate at all.
 *  2. **An unknown code is REFUSED, not answered with an empty page.** A mistyped or
 *     retired code returning `[]` would read as "nobody writes this", which is the exact
 *     failure the objection named — and the most dangerous form of it, because an empty
 *     list looks like an answer.
 *  3. **The one company a code-only filter could hide cannot exist.** A company recorded
 *     against an office's own "Motor Comprehensive" instead of the catalogue entry would be
 *     invisible here — so `InsuranceLineService` refuses that collision on both write
 *     paths, and `insurer-schema-constraints.e2e-spec.ts` asserts the colliding set is
 *     empty rather than this filter compensating for it. Measured: 0 collisions on both
 *     databases. The first draft of this filter DID match those by canonical name; it was
 *     removed once the measurement showed it covered nothing and cost the filter its
 *     predictability.
 *
 * What no filter here can reach is a SYNONYM: an office-added line called "Vehicle Cover"
 * is motor cover and no key-fold will ever say so, because `canonical_name_key` folds
 * orthography and never meaning — its own comment says exactly that. An office that adds
 * its own line type for cover the catalogue already names is describing its panel in
 * private vocabulary, and the fix is the line-management screen refusing the duplicate,
 * not the directory guessing.
 */
@Injectable()
export class InsurerDirectoryService {
  constructor(
    private readonly directory: InsurerDirectoryRepository,
    private readonly lines: InsuranceLineRepository,
  ) {}

  async list(
    query: ListInsurerDirectoryQueryDto,
  ): Promise<Paginated<InsurerDirectoryRow>> {
    const window = pageWindow(query.page, query.pageSize);
    const line = await this.resolveLine(query.lineCode);
    const [items, total] = await Promise.all([
      this.directory.findPage(query.search, window, line),
      this.directory.countPage(query.search, line),
    ]);
    return {
      // Mapped through the allow-list rather than passed through, so an extra column on
      // the view cannot reach a caller even before the test that forbids adding one.
      items: items.map((row) => this.toView(row)),
      total,
      page: window.page,
      pageSize: window.pageSize,
    };
  }

  /**
   * Turns a code into the line it names, or refuses.
   *
   * The refusal is the point. An unrecognised code answered with an empty page would tell
   * an office that nobody writes a line, when what actually happened is that the code does
   * not exist — and there is no way for the caller to tell those apart from `[]`.
   *
   * Only the PLATFORM catalogue is resolvable. An office's own line is deliberately not a
   * filter axis: two offices' private lines are different rows even under the same name, so
   * a filter keyed on one office's id could only ever match that office's own
   * registrations, and would read as a market search while being a search of one panel.
   */
  private async resolveLine(
    code: string | undefined,
  ): Promise<DirectoryLineFilter | undefined> {
    if (!code) return undefined;
    const line = await this.lines.findStandardByCode(code);
    if (!line) {
      throw new UnprocessableEntityException(
        `Unknown insurance line code "${code}". The directory filters on the platform catalogue — GET /insurance-lines lists every code. Refusing rather than returning an empty page, which would read as "no company writes this".`,
      );
    }
    return { code: line.code, nameEn: line.nameEn, nameAr: line.nameAr };
  }

  /**
   * Projects a row onto exactly `INSURER_DIRECTORY_COLUMNS`.
   *
   * Written as a pick over the allow-list instead of an object literal on purpose: a
   * literal is a second list, and two lists of what may cross an office boundary is one
   * more than can be kept in agreement.
   */
  private toView(row: InsurerDirectoryRow): InsurerDirectoryRow {
    const out = {} as Record<string, unknown>;
    for (const column of INSURER_DIRECTORY_COLUMNS) {
      out[column] = row[column];
    }
    return out as unknown as InsurerDirectoryRow;
  }
}
