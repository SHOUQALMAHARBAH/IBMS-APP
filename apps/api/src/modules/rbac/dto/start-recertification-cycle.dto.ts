import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class StartRecertificationCycleDto {
  @IsString()
  @Length(1, 100)
  cycleLabel!: string;

  /** Defaults to 15 business days out (Part A.8 SLA) if omitted. */
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
