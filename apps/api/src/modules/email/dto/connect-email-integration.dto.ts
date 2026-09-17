import { IsEmail, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { EmailProviderKind } from '@ibms/db';

export class AuthorizeUrlQueryDto {
  @IsEnum(EmailProviderKind)
  provider!: EmailProviderKind;
}

/**
 * Part I §6 — completes the OAuth authorization-code flow for this office.
 *
 * The authorization code is single-use and short-lived, and is exchanged
 * server-side; it is never stored. What is stored is the refresh token the
 * exchange returns, encrypted.
 */
export class ConnectEmailIntegrationDto {
  @IsEnum(EmailProviderKind)
  provider!: EmailProviderKind;

  @IsString()
  @Length(1, 4096)
  authorizationCode!: string;

  /** The mailbox to send from. Overridden by the consenting account's own
   * address when the provider returns one, so a typo cannot produce a mailbox
   * that only fails at the first real send. */
  @IsEmail()
  connectedEmail!: string;

  /** Microsoft only — the directory the mailbox lives in. Google does not use
   * it. Defaults to the multi-tenant `common` endpoint when omitted. */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  providerTenantId?: string;
}
