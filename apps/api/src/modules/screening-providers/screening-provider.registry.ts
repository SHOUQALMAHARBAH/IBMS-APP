import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BuiltInWatchlistProvider } from './built-in-watchlist.provider';
import { OnPremiseScreeningProvider } from './on-premise.provider';
import { CommercialScreeningProvider } from './commercial.provider';
import { NotConfiguredProvider } from './not-configured.provider';
import {
  DEFAULT_MATCH_THRESHOLDS,
  describeConfig,
  missingConfigFor,
  readScreeningConfig,
  thresholdProblems,
  type MatchThresholds,
  type ScreeningProviderConfig,
} from './screening-provider.config';
import type {
  ProviderHealth,
  ScreeningProvider,
} from './screening-provider.types';

/**
 * Chooses the screening provider from configuration.
 *
 * This is the ONLY place that knows which implementations exist. Business
 * logic asks for "the provider" and gets one — so connecting a commercial
 * provider later is a configuration change plus one adapter file, exactly as
 * the task requires, rather than a rewrite of the compliance module.
 *
 * Selection is re-evaluated per call rather than cached at construction, so a
 * deployment can change provider without a process restart, and so a test can
 * exercise every branch. The cost is a handful of object allocations on a path
 * that already makes a network or database call.
 */
@Injectable()
export class ScreeningProviderRegistry {
  private readonly logger = new Logger(ScreeningProviderRegistry.name);

  constructor(private readonly builtIn: BuiltInWatchlistProvider) {}

  /** A fresh correlation id for one screening, threaded through the provider
   * call, the logs, the audit trail and the case. */
  newCorrelationId(): string {
    return `scr-${randomUUID()}`;
  }

  config(): ScreeningProviderConfig {
    return readScreeningConfig();
  }

  /**
   * The provider in force.
   *
   * A deployment that ASKS for an external provider without supplying what it
   * needs gets `NotConfiguredProvider` — not a silent fallback to the built-in
   * cache. Falling back would be worse than failing: the operator believes
   * they are screening against a commercial PEP database and are in fact
   * getting a sanctions-only local list, with nothing in the system saying so.
   */
  resolve(): ScreeningProvider {
    const config = this.config();

    const missing = missingConfigFor(config);
    if (missing.length > 0) {
      this.logger.error(
        `Screening provider "${config.kind}" is selected but not configured (missing ${missing.join(', ')}). Screening will report NOT_CONFIGURED — it will NOT fall back to the built-in cache, because that would silently answer a different question than the operator asked.`,
      );
      return new NotConfiguredProvider(config.kind, missing);
    }

    switch (config.kind) {
      case 'on_premise':
        return new OnPremiseScreeningProvider(config);
      case 'commercial':
        return new CommercialScreeningProvider(config);
      case 'built_in':
      default:
        return this.builtIn;
    }
  }

  /**
   * The thresholds in force, with a safe fallback.
   *
   * A mis-ordered set (review above high) is a configuration error that would
   * make banding meaningless. It degrades to the documented defaults with a
   * loud log rather than refusing to screen — refusing would turn a typo into
   * an outage on a compliance control.
   */
  thresholds(): MatchThresholds {
    const configured = this.config().thresholds;
    const problems = thresholdProblems(configured);
    if (problems.length === 0) return configured;

    this.logger.error(
      `Screening match thresholds are mis-ordered and have been IGNORED in favour of the defaults: ${problems.join('; ')}`,
    );
    return DEFAULT_MATCH_THRESHOLDS;
  }

  /** Redacted configuration for the config screen. Never includes the key. */
  describe(): ReturnType<typeof describeConfig> {
    return describeConfig(this.config());
  }

  health(): Promise<ProviderHealth> {
    return this.resolve().getProviderHealth();
  }
}
