import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ScreeningProviderRegistry } from './screening-provider.registry';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';

/**
 * Screening configuration and data health.
 *
 * ## Read-only, on purpose
 *
 * Provider settings — base URL, API key, thresholds — come from the
 * ENVIRONMENT, not from a database row an admin edits in a browser. Two
 * reasons, and the first is the important one:
 *
 *  * A credential that can be written through an HTTP endpoint can be read
 *    back through one, and every screen that edits a key eventually grows a
 *    "show" button. Keeping the key in the deployment's secret store means
 *    there is no code path that can return it at all.
 *  * Which provider screens the broker's customers is a deployment decision
 *    with a data-sharing basis behind it, not a runtime toggle.
 *
 * So this surface answers "what is configured, and is it working?" — which is
 * what an operator actually needs, and what makes NOT_CONFIGURED visible
 * instead of silent.
 */
@ApiTags('screening')
@Controller('screening/providers')
export class ScreeningConfigController {
  constructor(private readonly registry: ScreeningProviderRegistry) {}

  /**
   * The configuration in force, REDACTED. `apiKeyConfigured` is a boolean;
   * the key itself is never returned, not even a masked tail.
   */
  @RequirePermissions('sanctions-pep.screen')
  @Get('config')
  config() {
    return this.registry.describe();
  }

  /**
   * Provider + dataset health (task §23).
   *
   * Reports HEALTHY / DEGRADED / UNAVAILABLE / NOT_CONFIGURED, plus the
   * dataset version a screening decision would currently be made against.
   * A stale or empty dataset is DEGRADED/UNAVAILABLE and is not quietly
   * treated as current.
   */
  @RequirePermissions('sanctions-pep.screen')
  @Get('health')
  async health() {
    const [health, config] = await Promise.all([
      this.registry.health(),
      Promise.resolve(this.registry.describe()),
    ]);
    return {
      ...health,
      thresholds: config.thresholds,
      missing: config.missing,
      thresholdProblems: config.thresholdProblems,
      sendIdentifiers: config.sendIdentifiers,
      /**
       * What this provider can and cannot answer.
       *
       * Stated explicitly because the backlog asks for "sanctions/PEP/AML" and
       * the built-in cache covers only sanctions. A health screen that implied
       * PEP coverage the deployment does not have would be worse than no
       * screen at all.
       */
      coverage:
        health.provider === 'built_in'
          ? {
              sanctions: true,
              pep: false,
              note: 'OFAC SDN + UN Consolidated are SANCTIONS lists. No PEP source is configured — PEP screening requires a commercial provider or an on-premise dataset that includes PEP data.',
            }
          : {
              sanctions: true,
              pep: true,
              note: 'Coverage depends on the datasets this provider is configured to search. Verify against the provider’s own documentation before relying on PEP coverage.',
            },
    };
  }
}
