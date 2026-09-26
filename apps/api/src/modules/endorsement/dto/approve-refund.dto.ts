import { CombinedDutyDeclarationDto } from '../../../common/dto/combined-duty-declaration.dto';

/**
 * `POST /refunds/:id/approve` — the body exists only for the combined-duty declaration.
 *
 * A named subclass rather than using the base directly, so the route's Swagger entry and its 422s say
 * "ApproveRefundDto" and a reader can find this file from the controller.
 */
export class ApproveRefundDto extends CombinedDutyDeclarationDto {}
