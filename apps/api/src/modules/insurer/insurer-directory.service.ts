import { Injectable } from '@nestjs/common';
import {
  InsurerDirectoryRepository,
  INSURER_DIRECTORY_COLUMNS,
  type InsurerDirectoryRow,
} from '../../repositories/insurer-directory.repository';
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
 */
@Injectable()
export class InsurerDirectoryService {
  constructor(private readonly directory: InsurerDirectoryRepository) {}

  async list(
    query: ListInsurerDirectoryQueryDto,
  ): Promise<Paginated<InsurerDirectoryRow>> {
    const window = pageWindow(query.page, query.pageSize);
    const [items, total] = await Promise.all([
      this.directory.findPage(query.search, window),
      this.directory.countPage(query.search),
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
