import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { CombinedDutyDeclarationDto } from '../../../common/dto/combined-duty-declaration.dto';

/**
 * Extends the shared declaration, so `combinedDutyReason` and its ten-character floor are defined once.
 *
 * On this route it is needed only when a subject has nobody but themselves to review their access — the
 * one-person office. Every other cycle sends nothing and behaves exactly as before.
 */
export class StartRecertificationCycleDto extends CombinedDutyDeclarationDto {
  @IsString()
  @Length(1, 100)
  cycleLabel!: string;

  /** Defaults to 15 business days out (Part A.8 SLA) if omitted. */
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
