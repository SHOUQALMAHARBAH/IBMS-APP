import { describe, expect, it } from 'vitest';
import {
  SECURE_DATA_SHARING_CHANNELS,
  assertSecureChannel,
  isSecureDataSharingChannel,
} from './secure-channel.util';
import type { DataClassification, DataSharingChannel } from '@ibms/db';

const ALL_CHANNELS: DataSharingChannel[] = [
  'SECURE_SFTP',
  'ENCRYPTED_EMAIL',
  'VENDOR_SECURE_PORTAL',
  'CBJ_REGULATORY_PORTAL',
  'IN_PERSON_ENCRYPTED_MEDIA',
  'UNENCRYPTED_EMAIL',
  'POSTAL_MAIL',
  'OTHER_UNSECURED',
];

describe('isSecureDataSharingChannel', () => {
  it('flags every channel in SECURE_DATA_SHARING_CHANNELS as secure', () => {
    for (const channel of SECURE_DATA_SHARING_CHANNELS) {
      expect(isSecureDataSharingChannel(channel)).toBe(true);
    }
  });

  it('flags every other channel as not secure', () => {
    const insecure = ALL_CHANNELS.filter(
      (c) => !SECURE_DATA_SHARING_CHANNELS.includes(c),
    );
    expect(insecure).toEqual(
      expect.arrayContaining([
        'UNENCRYPTED_EMAIL',
        'POSTAL_MAIL',
        'OTHER_UNSECURED',
      ]),
    );
    for (const channel of insecure) {
      expect(isSecureDataSharingChannel(channel)).toBe(false);
    }
  });
});

describe('assertSecureChannel', () => {
  it.each(['CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL'] as DataClassification[])(
    'rejects an insecure channel for %s data',
    (classification) => {
      expect(() =>
        assertSecureChannel(classification, 'UNENCRYPTED_EMAIL'),
      ).toThrow(/cannot be shared over UNENCRYPTED_EMAIL/);
    },
  );

  it.each(['CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL'] as DataClassification[])(
    'allows a secure channel for %s data',
    (classification) => {
      expect(() =>
        assertSecureChannel(classification, 'SECURE_SFTP'),
      ).not.toThrow();
    },
  );

  it('treats the regulatory channel as secure on its own merits', () => {
    expect(() =>
      assertSecureChannel('HIGHLY_CONFIDENTIAL', 'CBJ_REGULATORY_PORTAL'),
    ).not.toThrow();
  });

  it.each(['PUBLIC', 'INTERNAL'] as DataClassification[])(
    'does not restrict the channel for %s data',
    (classification) => {
      expect(() =>
        assertSecureChannel(classification, 'OTHER_UNSECURED'),
      ).not.toThrow();
    },
  );
});
