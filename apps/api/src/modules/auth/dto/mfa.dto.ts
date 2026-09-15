import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class MfaEnrollVerifyDto {
  @IsString()
  credentialId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class MfaChallengeVerifyDto {
  /**
   * Part II §4.4.2 — "optionally offer 'Trust this device for 30 days'".
   *
   * Honoured only for a role that is allowed the convenience; the server
   * refuses it for an always-MFA role whatever the client sends, because a
   * control that lives only in the UI is not a control.
   */
  @IsOptional()
  @IsBoolean()
  trustDevice?: boolean;

  /** Opaque, client-computed. Stored only as a hash, and only if trust is
   * actually granted. */
  @IsOptional()
  @IsString()
  @Length(8, 512)
  deviceFingerprint?: string;

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
