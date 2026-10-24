import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';
import { DECLARATION_REASON_MIN_LENGTH } from '../../../common/declaration-reason';
import {
  ARCHIVE_RETRIEVAL_BASES,
  type ArchiveRetrievalBasis,
} from '../retention-archive.config';

/**
 * `POST /retention-archive/retrievals` (`retention.archive.retrieve`) — condition 3 of the archived
 * state.
 *
 * THE BASIS IS AN ENUM AND THERE ARE EXACTLY TWO, both external compulsion: a court asked, or the
 * Central Bank asked. `@IsIn` makes a third a 400 at the boundary. An office retrieving a blocked
 * record for its own purposes is not retrieving it on a basis — it is processing it, which is the
 * thing the block forbids, so there is deliberately no "internal" option to pick.
 *
 * THE NOTE'S FLOOR COMES FROM `common/declaration-reason.ts` AND IS NOT WRITTEN AGAIN HERE. Two
 * different minimums for one concept is the drift this project keeps paying for; the extension DTO
 * beside it reads the same home through `EXTENSION_NOTE_MIN_LENGTH`.
 */
export class RetrieveBlockedRecordsDto {
  @IsString()
  @Length(1, 200)
  recordCategory!: string;

  /**
   * Which records. Bounded at 500, the extension DTO's own ceiling and for the same reason: a
   * judicial request or an audit can legitimately name many files, and an unbounded array is a
   * request that writes an unbounded number of append-only rows nobody can take back out.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  recordIds!: string[];

  @IsIn(ARCHIVE_RETRIEVAL_BASES)
  basis!: ArchiveRetrievalBasis;

  /** Which court, or which audit, and for what. Accompanies the basis; never replaces it. */
  @IsString()
  @Transform(trimIfString)
  @Length(DECLARATION_REASON_MIN_LENGTH, 2000)
  note!: string;
}
