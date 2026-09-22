import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { MapInsurerFormFieldDto } from './map-insurer-form.dto';

/**
 * Q9 — mapping THIS OFFICE's own copy of an insurer's submission form.
 *
 * The field shape is imported from `MapInsurerFormDto` rather than restated: a field is a field
 * whichever table its template lands in, and two copies of that validation is two places for a
 * future `maxLength` to be raised in one of them.
 *
 * ## One `lineId`, not two nullable ones
 *
 * The stored row has two nullable line columns with a CHECK that exactly one is set. This DTO
 * deliberately does NOT mirror that: a caller sending both, or neither, is a request that cannot
 * be honoured, and a DTO that can express it has to grow a cross-field validator to reject it
 * again. One required id, and the SERVICE resolves which catalogue it belongs to — which it must
 * do anyway, because an id has to be checked against a table before it can be trusted.
 *
 * That resolution is also the only thing that can tell the two apart honestly: the two id spaces
 * are both uuids, so nothing about the VALUE says which table it is from. Asking the caller to
 * declare it would let a caller be wrong about it.
 */
export class MapOfficeInsurerFormDto {
  /**
   * The line this form is for — a `InsuranceLine.id` from the shared catalogue OR an
   * `OfficeInsuranceLine.id` this office added. Either is legitimate here, which is the
   * difference from the global mapping endpoint: that one refuses an office's own line because
   * its row is readable by every office, and this row is readable by one.
   *
   * `@IsUUID()` only rejects things that are not ids at all; an id no line answers to is a 422
   * from the service naming it, because "that line does not exist" and "no form is mapped for
   * that line" are different answers a caller cannot tell apart from an empty result.
   */
  @IsUUID()
  lineId!: string;

  /** The uploaded PDF/Word this mapping was derived from, so it can be checked back against
   *  its source. Free text: it is a reference an administrator types, not a resolvable id —
   *  this system has no object storage, which `bilingual-ui.md` already records. */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  sourceDocumentRef?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => MapInsurerFormFieldDto)
  fields!: MapInsurerFormFieldDto[];
}
