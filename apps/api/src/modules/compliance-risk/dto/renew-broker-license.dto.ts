import { BrokerLicenseTermDto } from './broker-license-term.dto';

/**
 * Module 0 item (c) — `POST /broker-license/renew` (`license.manage` / Compliance). APPENDS the
 * next term; 404 if the office holds none yet (`create` first).
 *
 * IT NO LONGER OVERWRITES. Renewal used to be an `updateMany` over the single global row, so the
 * term being replaced was erased and the office could not show a regulator what it had been
 * licensed for last year. A renewal is a new term; the old one stays, with its own certificate,
 * its own dates and its own status.
 *
 * Every field is declared on `BrokerLicenseTermDto` — this class adds nothing, because the two
 * routes differ in what they require of the office's existing terms, not in what a term looks like.
 */
export class RenewBrokerLicenseDto extends BrokerLicenseTermDto {}
