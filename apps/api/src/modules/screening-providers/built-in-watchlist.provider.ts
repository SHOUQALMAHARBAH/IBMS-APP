import { Injectable, Logger } from '@nestjs/common';
import { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import {
  canonicalNameTokens,
  classifyMatch,
} from '../compliance-risk/watchlist-match.config';
import { normalizeWatchlistName } from '../compliance-risk/watchlist-sync.config';
import type {
  MatchedAttribute,
  ProviderCandidate,
  ProviderHealth,
  ProviderScreeningResult,
  ScreeningProvider,
  ScreeningProviderKind,
  ScreeningSubject,
} from './screening-provider.types';
import {
  readScreeningConfig,
  type ScreeningProviderConfig,
} from './screening-provider.config';
import { capability } from './screening-provider.types';
import type { CapabilityState } from './screening-provider.types';

/**
 * The provider this deployment actually runs today: the locally synced OFAC
 * SDN + UN Consolidated cache, matched by `watchlist-match.config.ts`.
 *
 * Wrapping the existing matcher in the provider contract rather than replacing
 * it is the whole point — the working, verified control keeps working, and an
 * external provider becomes an alternative implementation instead of a
 * rewrite.
 *
 * ## What it can and cannot answer
 *
 * OFAC and UN are SANCTIONS lists. This provider therefore never returns a PEP
 * candidate, and says so in its health output rather than implying PEP
 * coverage it does not have. Fabricating PEP data — or letting a sanctions hit
 * masquerade as one — would be the exact failure the task forbids.
 */
@Injectable()
export class BuiltInWatchlistProvider implements ScreeningProvider {
  readonly kind: ScreeningProviderKind = 'built_in';
  readonly name = 'Built-in watchlist cache (OFAC SDN + UN Consolidated)';

  private readonly logger = new Logger(BuiltInWatchlistProvider.name);

  constructor(private readonly entries: WatchlistEntryRepository) {}

  private config(): ScreeningProviderConfig {
    return readScreeningConfig();
  }

  async screenIndividual(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult> {
    return this.screen(subject, correlationId, 'individual');
  }

  async screenOrganization(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult> {
    return this.screen(subject, correlationId, 'organization');
  }

  async screenBatch(
    subjects: readonly ScreeningSubject[],
    correlationId: string,
  ): Promise<ProviderScreeningResult[]> {
    const results: ProviderScreeningResult[] = [];
    for (const subject of subjects) {
      results.push(
        await this.screen(subject, correlationId, subject.entityType),
      );
    }
    return results;
  }

  private async screen(
    subject: ScreeningSubject,
    correlationId: string,
    entityType: 'individual' | 'organization',
  ): Promise<ProviderScreeningResult> {
    const startedAt = Date.now();
    const base = {
      provider: this.kind,
      providerName: this.name,
      correlationId,
    };

    try {
      // An EMPTY cache is not a clear result. This is the state every
      // deployment of this system is in until the sync first runs, and
      // answering NO_MATCH from an empty table is false assurance on a
      // sanctions control.
      if (!(await this.entries.hasUsableEntries())) {
        return {
          ...base,
          outcome: 'UNABLE_TO_SCREEN',
          candidates: [],
          failureReason:
            'The local sanctions cache is empty — the watchlist sync has never completed. Run POST /watchlist-sync/run.',
          durationMs: Date.now() - startedAt,
        };
      }

      const subjectTokens = canonicalNameTokens(subject.fullName);
      const normalizedName = normalizeWatchlistName(subject.fullName);
      if (subjectTokens.length === 0 && !normalizedName) {
        return {
          ...base,
          outcome: 'UNABLE_TO_SCREEN',
          candidates: [],
          failureReason:
            'The subject name contains no screenable characters, so no comparison could be made.',
          durationMs: Date.now() - startedAt,
        };
      }

      const found = await this.entries.findMatchCandidates({
        subjectTokens,
        normalizedName,
      });
      if (found.truncated) {
        // Surfaced, never swallowed: a reviewer working a truncated candidate
        // list has no other way to know evidence was dropped.
        this.logger.error(
          `${correlationId}: candidate list for a subject hit the per-name cap; the returned candidates are INCOMPLETE.`,
        );
      }

      const candidates = found.entries.map((entry) =>
        this.toCandidate(entry, subject, entityType),
      );

      const datasetVersion = await this.datasetVersion();
      return {
        ...base,
        outcome: candidates.length > 0 ? 'POTENTIAL_MATCH' : 'NO_MATCH',
        candidates,
        datasetVersion,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      // A failure is SCREENING_FAILED, never an empty candidate list.
      return {
        ...base,
        outcome: 'SCREENING_FAILED',
        candidates: [],
        failureReason: (err as Error).message,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Scores a local match.
   *
   * The built-in matcher is deterministic set logic, not a similarity engine,
   * so a fabricated fractional score would be false precision. It reports the
   * two states it can genuinely distinguish: an exact canonical match, and a
   * containment (subset) match. Both land above the default review threshold
   * because both warrant a human decision; only the exact one reaches the
   * high band.
   */
  private toCandidate(
    entry: {
      id: string;
      source: string;
      sourceRecordId: string;
      fullName: string;
      listProgram: string | null;
      remarks: string | null;
    },
    subject: ScreeningSubject,
    entityType: 'individual' | 'organization',
  ): ProviderCandidate {
    const matchType = classifyMatch(subject.fullName, entry.fullName);
    const matchedAttributes: MatchedAttribute[] = ['name'];

    return {
      providerEntityId: `${entry.source}:${entry.sourceRecordId}`,
      entityName: entry.fullName,
      entityType,
      // OFAC SDN and the UN Consolidated List are SANCTIONS lists. Never PEP —
      // this provider has no PEP data, and saying otherwise would invent it.
      listType: 'SANCTIONS',
      score: matchType === 'exact' ? 0.95 : 0.75,
      matchedAttributes,
      sourceList: entry.listProgram
        ? `${entry.source} (${entry.listProgram})`
        : entry.source,
      remarks: entry.remarks,
      pepPosition: null,
    };
  }

  /** The freshest successful sync across both sources, as a version string. */
  private async datasetVersion(): Promise<string | null> {
    const runs = await this.entries.findLatestSyncRuns();
    const succeeded = runs.filter((r) => r.status === 'succeeded');
    if (succeeded.length === 0) return null;
    const newest = succeeded.reduce((a, b) =>
      a.startedAt > b.startedAt ? a : b,
    );
    return `local-${newest.startedAt.toISOString()}`;
  }

  /**
   * OFAC SDN and the UN Consolidated List are SANCTIONS lists.
   *
   * `PEP: supported=false` is the honest answer and the most important row in
   * this table — the backlog asks for "sanctions/PEP/AML", and a deployment
   * running only this provider has NO PEP coverage. Reporting otherwise would
   * be the fabrication the task forbids.
   */
  capabilities(hasData = true): CapabilityState[] {
    return [
      capability(
        'SANCTIONS',
        true,
        true,
        hasData,
        hasData
          ? 'OFAC SDN + UN Consolidated, synced locally.'
          : 'Configured, but the local cache is empty — the sync has never completed.',
      ),
      capability(
        'PEP',
        false,
        false,
        false,
        'This provider has NO PEP data. PEP screening requires a commercial provider or an on-premise dataset that includes PEP data.',
      ),
      capability(
        'WATCHLIST',
        false,
        false,
        false,
        'Only sanctions lists are synced.',
      ),
      capability('ADVERSE_MEDIA', false, false, false, 'Not available.'),
      capability('INDIVIDUAL', true, true, hasData, 'Names are matched.'),
      capability('ENTITY', true, true, hasData, 'Legal names are matched.'),
      capability(
        'BATCH',
        true,
        true,
        hasData,
        'Batched locally; no external rate limit applies.',
      ),
      capability(
        'ONGOING_MONITORING',
        true,
        true,
        hasData,
        'The 4-hourly re-screening batch plus re-screening on list update.',
      ),
      capability(
        'WEBHOOKS',
        false,
        false,
        false,
        'Not applicable to a local cache.',
      ),
    ];
  }

  async getProviderHealth(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const runs = await this.entries.findLatestSyncRuns();
    const succeeded = runs.filter((r) => r.status === 'succeeded');
    const hasData = await this.entries.hasUsableEntries();

    if (!hasData || succeeded.length === 0) {
      return {
        provider: this.kind,
        providerName: this.name,
        status: 'UNAVAILABLE',
        // CONFIGURED, not NOT_CONFIGURED: the provider is set up correctly and
        // simply has no data yet. Conflating the two would send an operator
        // looking for a missing setting that is not missing.
        state: 'CONFIGURED',
        detail:
          'The local sanctions cache is empty — the watchlist sync has never completed successfully. No customer can be screened against a real list until it does.',
        checkedAt,
        capabilities: this.capabilities(false),
        authenticationValid: null,
      };
    }

    const newest = succeeded.reduce((a, b) =>
      a.startedAt > b.startedAt ? a : b,
    );
    const ageHours = (Date.now() - newest.startedAt.getTime()) / 3_600_000;
    const staleAfter = this.config().datasetStaleAfterHours;

    return {
      provider: this.kind,
      providerName: this.name,
      status: ageHours > staleAfter ? 'DEGRADED' : 'HEALTHY',
      state: ageHours > staleAfter ? 'DEGRADED' : 'HEALTHY',
      detail:
        ageHours > staleAfter
          ? `The sanctions cache was last refreshed ${Math.floor(ageHours)}h ago, beyond the ${staleAfter}h staleness tolerance. Sanctions lists change; screening against this data is not current. Covers SANCTIONS only — no PEP source is configured.`
          : `Sanctions cache refreshed ${Math.floor(ageHours)}h ago. Covers SANCTIONS only (OFAC SDN + UN Consolidated) — no PEP source is configured.`,
      datasetVersion: `local-${newest.startedAt.toISOString()}`,
      datasetUpdatedAt: newest.startedAt.toISOString(),
      checkedAt,
      capabilities: this.capabilities(true),
      // The local cache needs no credentials, so "is authentication valid?"
      // has no answer here — null rather than a misleading `true`.
      authenticationValid: null,
    };
  }
}
