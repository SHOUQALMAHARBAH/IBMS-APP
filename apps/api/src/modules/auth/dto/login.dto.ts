import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  /**
   * Part II §4.4 — an opaque, client-computed device fingerprint.
   *
   * Optional, and only ever able to SHORTEN the second factor for a user who
   * has already proven the first: it is client-supplied, so it is a hint, never
   * a credential. Stored hashed if the user later chooses to trust the device.
   */
  @IsOptional()
  @IsString()
  @Length(8, 512)
  deviceFingerprint?: string;
}
