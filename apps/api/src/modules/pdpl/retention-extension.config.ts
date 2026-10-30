/**
 * THE EXTENSION BASIS — A CLOSED LIST OF THREE, NOT A TEXT BOX.
 *
 * ## WHY A FIELD WAS NOT THE ANSWER
 *
 * The brief that asked for "a basis field plus a register" was withdrawn, and the adviser is why:
 * extending retention WITHOUT legislative cover and WITHOUT the customer's consent "carries high
 * legal risk and exposes the office to liability and penalties under the Personal Data Protection
 * Law". A field accepts any sentence, including a sentence that is not a basis at all.
 *
 * MEASURED: `RetentionScheduleItem.legalBasis` is `String?` — any sentence, or nothing. That is the
 * shape being replaced here, for the EXTEND act.
 *
 * So the basis is one of exactly three, and FREE TEXT MAY ACCOMPANY A BASIS BUT MAY NOT BE ONE.
 *
 * ## THE CONSENT BASIS IS NOT SELF-SERVICE, AND TODAY IT IS NOT SELECTABLE
 *
 * Consent for one purpose does not cover a new purpose, nor a period much longer than the customer
 * agreed. So this basis requires the recorded consent's own DURATION and PURPOSE, and a period
 * beyond what that consent states is REFUSED rather than warned.
 *
 * MEASURED, and the precise reason matters because it is not the one the brief anticipated:
 * `ConsentRecord` EXISTS and carries `purpose`, `grantedAt` and `withdrawnAt` — but **no duration
 * of any kind**. So the basis cannot be substantiated as to duration, which is exactly the half that
 * makes it a basis rather than a sentiment. An option that cannot be substantiated must not be
 * offerable, so it is UNSELECTABLE and says why — and the reason given is "consent records carry no
 * duration", not "no consent record exists", because the second would be false.
 */

import { UnprocessableEntityException } from '@nestjs/common';
import { DECLARATION_REASON_MIN_LENGTH } from '../../common/declaration-reason';

/** The three, and there is no fourth. */
export const EXTENSION_BASES = [
  'LEGISLATIVE_PROVISION',
  'LEGAL_HOLD_OR_DISPUTE',
  'CUSTOMER_EXPLICIT_CONSENT',
] as const;
export type ExtensionBasis = (typeof EXTENSION_BASES)[number];

/**
 * The accompanying note's floor, read from the ONE home for that figure.
 *
 * Not written as a number here: `common/declaration-reason.ts` exists precisely because "two
 * different minimums for one concept is the drift we keep paying for", and an extension's note is
 * the same concept as a declaration's reason — somebody explaining, in writing, a decision that has
 * to be justifiable a year later.
 */
export const EXTENSION_NOTE_MIN_LENGTH = DECLARATION_REASON_MIN_LENGTH;

export interface ExtensionBasisDefinition {
  basis: ExtensionBasis;
  /** `false` means the screen must not offer it, and must say why. */
  selectable: boolean;
  /** Why it is unselectable, for the screen to render. Empty when it is selectable. */
  unselectableReason: string;
  /** What this basis requires beyond the note — checked in `assertExtensionBasis`. */
  requires: readonly string[];
}

export const EXTENSION_BASIS_DEFINITIONS: readonly ExtensionBasisDefinition[] =
  [
    {
      basis: 'LEGISLATIVE_PROVISION',
      selectable: true,
      unselectableReason: '',
      requires: ['instrument', 'article'],
    },
    {
      basis: 'LEGAL_HOLD_OR_DISPUTE',
      selectable: true,
      unselectableReason: '',
      // A REFERENCE TO A ROW, not a description of one. A hold is the single one of the three old
      // destruction conditions that survives as a machine, because it is a stored fact rather than
      // a judgement — so the basis points at the fact.
      requires: ['legalHoldId'],
    },
    {
      basis: 'CUSTOMER_EXPLICIT_CONSENT',
      selectable: false,
      unselectableReason:
        'This basis needs the recorded consent to state its own DURATION, so a period beyond what ' +
        'the customer agreed can be refused. Consent records in this system carry a purpose, a ' +
        'grant date and a withdrawal date — and NO duration. Until one is recorded, an extension ' +
        'cannot be checked against what the customer actually agreed to, so this basis is not ' +
        'offered. It is not that no consent exists; it is that consent here does not say for how long.',
      requires: ['consentRecordId', 'consentDuration', 'consentPurpose'],
    },
  ] as const;

export function basisDefinition(
  basis: ExtensionBasis,
): ExtensionBasisDefinition {
  const found = EXTENSION_BASIS_DEFINITIONS.find((d) => d.basis === basis);
  if (!found) {
    // Unreachable through the DTO's enum, and a loud programming error rather than a silent default:
    // a basis nobody defined must never fall through to "accepted".
    throw new Error(`no definition for extension basis ${basis}`);
  }
  return found;
}

export interface ExtensionBasisInput {
  basis: ExtensionBasis;
  note: string;
  instrument?: string;
  article?: string;
  legalHoldId?: string;
  consentRecordId?: string;
  consentDuration?: string;
  consentPurpose?: string;
}

/**
 * REFUSES an extension whose basis is not substantiated — and the refusals are about the BASIS,
 * never about the period's length.
 *
 * Returns nothing; it throws or it passes. The caller then writes the register row, which is what
 * makes every extension justifiable from one place.
 */
export function assertExtensionBasis(input: ExtensionBasisInput): void {
  const definition = basisDefinition(input.basis);

  if (!definition.selectable) {
    throw new UnprocessableEntityException({
      code: 'EXTENSION_BASIS_NOT_SELECTABLE',
      message: definition.unselectableReason,
      basis: input.basis,
    });
  }

  const missing = definition.requires.filter((field) => {
    const value = (input as unknown as Record<string, unknown>)[field];
    return typeof value !== 'string' || value.trim() === '';
  });
  if (missing.length > 0) {
    throw new UnprocessableEntityException({
      code: 'EXTENSION_BASIS_INCOMPLETE',
      message:
        `An extension on the basis of ${input.basis} requires ${missing.join(', ')}. ` +
        'A basis that cannot be pointed at is not a basis — free text may accompany one, it cannot be one.',
      basis: input.basis,
      missing,
    });
  }

  /*
   * THE NOTE ACCOMPANIES THE BASIS AND CANNOT REPLACE IT. Required, because an extension has to be
   * justifiable a year later and the basis alone says which KIND of cover was claimed rather than
   * what the office was actually relying on. Its floor is the shared declaration minimum.
   */
  if (input.note.trim().length < EXTENSION_NOTE_MIN_LENGTH) {
    throw new UnprocessableEntityException({
      code: 'EXTENSION_NOTE_TOO_SHORT',
      message:
        `An extension needs an accompanying note of at least ${EXTENSION_NOTE_MIN_LENGTH} characters ` +
        'saying what the office is relying on. The basis says which kind of cover is claimed; the note ' +
        'says what it actually is.',
      noteMinLength: EXTENSION_NOTE_MIN_LENGTH,
    });
  }
}
