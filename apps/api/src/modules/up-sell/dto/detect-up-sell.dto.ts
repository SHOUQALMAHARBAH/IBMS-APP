import { IsUUID } from 'class-validator';

/** Process 9 — run an on-demand under-insurance scan for one customer. The
 * scan itself is automated (UpSellDetectionScheduler runs nightly); this
 * endpoint just lets a Sales Officer refresh a single customer now (e.g.
 * right after adding assets to the risk survey). */
export class DetectUpSellDto {
  @IsUUID()
  customerId!: string;
}
