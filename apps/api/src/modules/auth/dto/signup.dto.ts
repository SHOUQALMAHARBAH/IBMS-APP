import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsOptional()
  @IsEnum(['AR', 'EN'])
  languagePreference?: 'AR' | 'EN';
}
