import { BadRequestException } from '@nestjs/common';
import type { DataClassification, DataSharingChannel } from '@ibms/db';

/**
 * Part 10.6/M08 — the data-sharing channel picklist for `DataSharingApproval`
 * (ibms-brain/meta/lex/sensitive-data-handling.md: "any data share (M08)
 * where the picked channel is not on the approved secure-channel list for
 * that classification" triggers the rule). "It's going to the regulator" is
 * not an exemption from classification discipline
 * (ibms-brain/meta/context/pcms-privacy-modules.md) — CBJ_REGULATORY_PORTAL
 * is on the secure list on its own merits, not because
 * `isRegulatoryChannel` is set.
 */
export const SECURE_DATA_SHARING_CHANNELS: readonly DataSharingChannel[] = [
  'SECURE_SFTP',
  'ENCRYPTED_EMAIL',
  'VENDOR_SECURE_PORTAL',
  'CBJ_REGULATORY_PORTAL',
  'IN_PERSON_ENCRYPTED_MEDIA',
];

/**
 * Classifications combining multiple levels are classified at the highest
 * present (Part 6.1 §6.7) — PUBLIC/INTERNAL data has no channel restriction,
 * CONFIDENTIAL and above must use a secure channel.
 */
const CLASSIFICATIONS_REQUIRING_SECURE_CHANNEL: readonly DataClassification[] =
  ['CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL'];

export function isSecureDataSharingChannel(
  channel: DataSharingChannel,
): boolean {
  return SECURE_DATA_SHARING_CHANNELS.includes(channel);
}

/**
 * Call this before persisting/deciding a `DataSharingApproval` (or any
 * future data-share write path). Throws rather than silently downgrading
 * the channel — the requester picks again, the same shape as a form
 * validation error.
 */
export function assertSecureChannel(
  classification: DataClassification,
  channel: DataSharingChannel,
): void {
  if (
    CLASSIFICATIONS_REQUIRING_SECURE_CHANNEL.includes(classification) &&
    !isSecureDataSharingChannel(channel)
  ) {
    throw new BadRequestException(
      `${classification} data cannot be shared over ${channel} — choose a secure channel (${SECURE_DATA_SHARING_CHANNELS.join(', ')})`,
    );
  }
}
