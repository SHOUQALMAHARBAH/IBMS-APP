import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Asset, RiskProfile } from '@ibms/db';
import { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { quantizeMoney } from '../../common/money.util';
import {
  consolidateSites,
  deriveSumInsured,
  type ConsolidatedSurvey,
  type SiteSurvey,
  type SumInsuredSummary,
  type SurveyableAsset,
} from './risk-profile.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateRiskProfileDto } from './dto/create-risk-profile.dto';
import type { CreateAssetDto } from './dto/create-asset.dto';

/** A Risk Profile with its Process 6 asset survey and the Sum Insured /
 * indemnity-period figures derived from it. */
export interface RiskProfileWithSurvey extends RiskProfile {
  assets: Asset[];
  sumInsured: SumInsuredSummary;
}

/** Process 6 — Risk Assessment (backlog Part C #6). Extends the minimal
 * Risk Profile parent (Part C #5) with the detailed asset survey
 * (building/equipment/stock/annual profit/fleet), the deterministic Sum
 * Insured + indemnity-period derivation, and the multi-site consolidation.
 *
 * A Risk Profile inherits its visibility from its Customer: the
 * Sales/Relationship Officer who owns that Customer sees it;
 * Placement/Manager/Executive (CUSTOMER_FILE_CROSS_OWNER_ROLES) work the
 * whole book. Assets carry no workflow state and no maker/checker — they are
 * survey data captured under `risk-profile.create` and read under
 * `risk-profile.read`. Every monetary roll-up goes through money.util.ts
 * (see risk-profile.config.ts). */
@Injectable()
export class RiskProfileService {
  private readonly logger = new Logger(RiskProfileService.name);

  constructor(
    private readonly riskProfiles: RiskProfileRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
  ) {}

  private canReachAnyCustomer(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (CUSTOMER_FILE_CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
  }

  /** Logged, not thrown — the real write already committed; an audit hiccup
   * must not turn a successful operation into a reported failure (same
   * philosophy as CustomerService/ProspectService/NeedsAssessmentService). */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `RiskProfile ${input.entityId}: audit record (${input.action}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** Resolves the Customer behind a would-be or existing Risk Profile and
   * enforces the caller's visibility on it. A NotFoundException either way
   * (missing customer, or one the caller can't see) so the response can't be
   * used as an existence oracle for another officer's customer — same
   * pattern as CustomerService.findOwnedOrVisible(). */
  private async assertCustomerVisible(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const customer = await this.customers.findById(customerId);
    if (
      !customer ||
      (!this.canReachAnyCustomer(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Customer not found');
    }
  }

  /** find-or-404 a Risk Profile with the Customer visibility gate applied;
   * the two failure modes collapse into one NotFoundException. */
  private async findVisibleProfile(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<RiskProfile> {
    const riskProfile = await this.riskProfiles.findById(id);
    if (!riskProfile) {
      throw new NotFoundException('RiskProfile not found');
    }
    try {
      await this.assertCustomerVisible(riskProfile.customerId, actor);
    } catch {
      throw new NotFoundException('RiskProfile not found');
    }
    return riskProfile;
  }

  /** Resolves an asset that must belong to the given (already visibility-
   * checked) Risk Profile — a NotFoundException if it is missing or hangs
   * off a different profile, so an assetId can't probe another profile. */
  private async findAssetInProfile(
    riskProfileId: string,
    assetId: string,
  ): Promise<Asset> {
    const asset = await this.riskProfiles.findAssetById(assetId);
    if (!asset || asset.riskProfileId !== riskProfileId) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }

  private toSurveyable(asset: Asset): SurveyableAsset {
    return {
      assetType: asset.assetType,
      declaredValue: asset.declaredValue,
      annualGrossProfit: asset.annualGrossProfit,
      indemnityPeriodMonths: asset.indemnityPeriodMonths,
      fleetVehicleCount: asset.fleetVehicleCount,
    };
  }

  async create(
    dto: CreateRiskProfileDto,
    actor: AuthenticatedUser,
  ): Promise<RiskProfile> {
    await this.assertCustomerVisible(dto.customerId, actor);

    const riskProfile = await this.riskProfiles.create({
      customerId: dto.customerId,
      siteLabel: dto.siteLabel,
      priorClaimsHistorySummary: dto.priorClaimsHistorySummary,
    });

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'RiskProfile',
      entityId: riskProfile.id,
      afterValue: {
        customerId: riskProfile.customerId,
        siteLabel: riskProfile.siteLabel,
      },
    });

    return riskProfile;
  }

  async list(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<RiskProfile[]> {
    await this.assertCustomerVisible(customerId, actor);
    return this.riskProfiles.findManyByCustomerId(customerId);
  }

  /** One Risk Profile with its asset survey and derived Sum Insured. */
  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<RiskProfileWithSurvey> {
    const riskProfile = await this.findVisibleProfile(id, actor);
    const assets = await this.riskProfiles.findAssetsByRiskProfileId(id);
    return {
      ...riskProfile,
      assets,
      sumInsured: deriveSumInsured(assets.map((a) => this.toSurveyable(a))),
    };
  }

  /** Every site's survey for a customer, plus the consolidated roll-up (the
   * figure a multi-site client's single Insurance Program is built from —
   * Program assembly itself is Process 7). */
  async getConsolidated(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<ConsolidatedSurvey> {
    await this.assertCustomerVisible(customerId, actor);
    const [profiles, assets] = await Promise.all([
      this.riskProfiles.findManyByCustomerId(customerId),
      this.riskProfiles.findAssetsByCustomerId(customerId),
    ]);

    const assetsByProfile = new Map<string, Asset[]>();
    for (const asset of assets) {
      const bucket = assetsByProfile.get(asset.riskProfileId);
      if (bucket) bucket.push(asset);
      else assetsByProfile.set(asset.riskProfileId, [asset]);
    }

    const sites: SiteSurvey[] = profiles.map((profile) => ({
      riskProfileId: profile.id,
      siteLabel: profile.siteLabel,
      summary: deriveSumInsured(
        (assetsByProfile.get(profile.id) ?? []).map((a) =>
          this.toSurveyable(a),
        ),
      ),
    }));

    return consolidateSites(customerId, sites);
  }

  async addAsset(
    riskProfileId: string,
    dto: CreateAssetDto,
    actor: AuthenticatedUser,
  ): Promise<Asset> {
    await this.findVisibleProfile(riskProfileId, actor);

    const asset = await this.riskProfiles.createAsset({
      riskProfileId,
      assetType: dto.assetType,
      description: dto.description,
      declaredValue:
        dto.declaredValue != null
          ? quantizeMoney(dto.declaredValue)
          : undefined,
      annualGrossProfit:
        dto.annualGrossProfit != null
          ? quantizeMoney(dto.annualGrossProfit)
          : undefined,
      indemnityPeriodMonths: dto.indemnityPeriodMonths,
      fleetVehicleCount: dto.fleetVehicleCount,
    });

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Asset',
      entityId: asset.id,
      afterValue: {
        riskProfileId,
        assetType: asset.assetType,
        declaredValue: asset.declaredValue?.toString() ?? null,
        annualGrossProfit: asset.annualGrossProfit?.toString() ?? null,
        indemnityPeriodMonths: asset.indemnityPeriodMonths,
        fleetVehicleCount: asset.fleetVehicleCount,
      },
    });

    return asset;
  }

  async updateAsset(
    riskProfileId: string,
    assetId: string,
    dto: CreateAssetDto,
    actor: AuthenticatedUser,
  ): Promise<Asset> {
    await this.findVisibleProfile(riskProfileId, actor);
    await this.findAssetInProfile(riskProfileId, assetId);

    const updated = await this.riskProfiles.updateAsset(assetId, {
      assetType: dto.assetType,
      description: dto.description,
      declaredValue:
        dto.declaredValue != null
          ? quantizeMoney(dto.declaredValue)
          : undefined,
      annualGrossProfit:
        dto.annualGrossProfit != null
          ? quantizeMoney(dto.annualGrossProfit)
          : undefined,
      indemnityPeriodMonths: dto.indemnityPeriodMonths,
      fleetVehicleCount: dto.fleetVehicleCount,
    });

    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Asset',
      entityId: assetId,
      afterValue: {
        riskProfileId,
        assetType: updated.assetType,
        declaredValue: updated.declaredValue?.toString() ?? null,
        annualGrossProfit: updated.annualGrossProfit?.toString() ?? null,
        indemnityPeriodMonths: updated.indemnityPeriodMonths,
        fleetVehicleCount: updated.fleetVehicleCount,
      },
    });

    return updated;
  }

  async removeAsset(
    riskProfileId: string,
    assetId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await this.findVisibleProfile(riskProfileId, actor);
    const asset = await this.findAssetInProfile(riskProfileId, assetId);

    await this.riskProfiles.deleteAsset(assetId);

    await this.safeAudit({
      userId: actor.id,
      action: 'DELETE',
      entityType: 'Asset',
      entityId: assetId,
      beforeValue: { riskProfileId, assetType: asset.assetType },
    });
  }
}
