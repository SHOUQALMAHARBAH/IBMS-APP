/**
 * Part 10.1 — "SSO integration point for an enterprise identity provider,
 * optional per broker." No identity provider has been chosen (see
 * ibms-brain's designs — that decision is explicitly not this repo's to
 * invent), so this is a strategy interface only: whichever IdP integration
 * gets built later (SAML, OIDC, ...) implements this and gets registered
 * with SsoController, rather than the callback route hard-coding a vendor.
 */
export interface SsoProviderStrategy {
  /** Machine-readable id used in the callback route, e.g. "azure-ad", "okta". */
  readonly providerId: string;

  /** Exchanges the IdP's callback payload for a resolved local user id. */
  handleCallback(payload: unknown): Promise<{ userId: string }>;
}
