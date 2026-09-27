import { IsIn } from 'class-validator';
import { CombinedDutyDeclarationDto } from '../../../common/dto/combined-duty-declaration.dto';
import type { RecertificationDecision } from '../services/access-recertification.service';

/** Needed only when the reviewer IS the subject — the self-review the cycle already declared. */
export class RecertificationDecisionDto extends CombinedDutyDeclarationDto {
  @IsIn(['confirmed', 'revoked', 'changed'])
  decision!: RecertificationDecision;
}
