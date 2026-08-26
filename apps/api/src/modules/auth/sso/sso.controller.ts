import { Controller, NotImplementedException, Post } from '@nestjs/common';
import { ApiNotImplementedResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';

/**
 * Feature-flagged stub — see sso-provider.interface.ts. Returns 501 until a
 * broker-specific SsoProviderStrategy is registered here; no IdP is wired.
 */
@ApiTags('auth')
@Controller('auth/sso')
export class SsoController {
  @Public()
  @Post(':provider/callback')
  @ApiNotImplementedResponse({
    description: 'No SSO identity provider is configured for this broker yet.',
  })
  callback(): never {
    throw new NotImplementedException(
      'SSO is not configured for this deployment yet',
    );
  }
}
