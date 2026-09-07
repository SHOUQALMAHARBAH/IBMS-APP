import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PolicyDocumentInputDto } from './policy-document-input.dto';

/** Attach one or more documents to a policy's electronic Insurance File
 * (Part 4.2) at any lifecycle stage — the standalone path used when
 * certificates / an endorsement template / the wording PDF arrive after the
 * issuance call, or on their own later. */
export class AttachPolicyDocumentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PolicyDocumentInputDto)
  documents!: PolicyDocumentInputDto[];
}
