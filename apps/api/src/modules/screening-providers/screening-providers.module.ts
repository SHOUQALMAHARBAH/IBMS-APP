import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import { BuiltInWatchlistProvider } from './built-in-watchlist.provider';
import { ScreeningProviderRegistry } from './screening-provider.registry';

/**
 * The screening provider seam.
 *
 * `@Global` for the same reason `SlaModule` is: the registry is infrastructure
 * that several domain modules resolve, and threading an import through each of
 * them adds nothing but the opportunity for a module cycle.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    WatchlistEntryRepository,
    BuiltInWatchlistProvider,
    ScreeningProviderRegistry,
  ],
  exports: [ScreeningProviderRegistry, BuiltInWatchlistProvider],
})
export class ScreeningProvidersModule {}
