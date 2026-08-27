import { IsUUID } from 'class-validator';

/** Process 8 — run an on-demand cross-sell gap scan for one customer. The
 * scan itself is automated (CrossSellDetectionScheduler runs nightly); this
 * endpoint just lets a Sales Officer refresh a single customer's gaps now
 * (e.g. right after a new policy incepts). */
export class DetectCrossSellDto {
  @IsUUID()
  customerId!: string;
}
