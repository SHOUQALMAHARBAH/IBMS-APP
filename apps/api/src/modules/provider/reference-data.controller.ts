import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReferenceDataService } from './reference-data.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';

/**
 * MODULE 0-ب — the eight provider-maintained vocabularies, for the screens that offer them.
 *
 * ## THE GATE, AND WHY IT IS THIS ONE
 *
 * `provider.office.register` is the only capability that needs these lists today, so it is the gate
 * — the same call `/audit-trail/actors` made: a picker-support route is gated on the permissions of
 * the screens that use it, and inventing a code nobody else holds would be a checkbox that removes
 * nothing.
 *
 * It WILL need widening. Item (e) registers an insurance company from the same lists, and an office
 * correcting its own address will need the city list. When that happens the gate becomes an ANY-OF,
 * which is a one-line decision then rather than a code invented now against a caller that does not
 * exist — the rule `permission-enforcement.inventory.spec.ts` enforces.
 */
@ApiTags('provider')
@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly reference: ReferenceDataService) {}

  @RequirePermissions('provider.office.register')
  @Get()
  all() {
    return this.reference.all();
  }
}
