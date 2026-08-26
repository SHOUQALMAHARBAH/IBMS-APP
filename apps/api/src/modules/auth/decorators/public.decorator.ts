import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts a route out of the global JwtAuthGuard — no access token required. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
