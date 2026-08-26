import { IsOptional, IsString, Length } from 'class-validator';

export class StepUpDto {
  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  code?: string;
}
