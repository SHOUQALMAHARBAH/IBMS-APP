import { IsUUID } from 'class-validator';

/** `GET /documents/classification-summary?policyId=` — the "highest
 * classification present" rollup for one Policy's electronic Insurance
 * File (Part 4.2 / `PRIV-STD-02` §6.7). Scoped to `Document.policyId` only
 * — a claim-linked document (joined via `ClaimDocument`, never carrying its
 * own `policyId`) is deliberately out of scope, matching the schema's own
 * "every Policy resolves to ONE electronic Insurance File" framing. */
export class PolicyFileClassificationQueryDto {
  @IsUUID()
  policyId!: string;
}
