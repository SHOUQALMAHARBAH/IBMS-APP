import { IsString, Length } from 'class-validator';

export class MfaEnrollVerifyDto {
  @IsString()
  credentialId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class MfaChallengeVerifyDto {
  @IsString()
  mfaChallengeToken!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class MfaDisableDto {
  @IsString()
  password!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
