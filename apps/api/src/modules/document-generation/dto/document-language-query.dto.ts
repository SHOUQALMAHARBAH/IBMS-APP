import { IsIn, IsOptional } from 'class-validator';

/** Part F item #7 — shared by every document-generation endpoint.
 * Omitted -> the underlying customer's own `languagePreference` (the
 * backlog's "client's preferred language" default); `DUAL` renders both,
 * Arabic section first (this system's primary language). */
export class DocumentLanguageQueryDto {
  @IsOptional()
  @IsIn(['AR', 'EN', 'DUAL'])
  language?: 'AR' | 'EN' | 'DUAL';
}
