import { BrokerLicenseTermDto } from './broker-license-term.dto';

/**
 * Module 0 item (c) — `POST /broker-license` (`license.manage` / Compliance). Records this
 * office's FIRST licence term; 409 if it already holds one (use `renew`, which appends the next).
 *
 * "This office's" is the part that changed. The route used to write a row keyed by a global
 * constant, so the second office to call it collided on the primary key and could never hold a
 * licence at all. Terms are now per-office rows and this 409 is per-office too.
 *
 * `issuedAt`/`expiresAt` are plain calendar dates (`parseCalendarDate`), not restricted to past or
 * future. Every field is declared on `BrokerLicenseTermDto`.
 */
export class CreateBrokerLicenseDto extends BrokerLicenseTermDto {}
