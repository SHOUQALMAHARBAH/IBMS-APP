import { describe, expect, it } from 'vitest';
import {
  DATASET_LIST_TYPES,
  classifyList,
  knownDatasetIds,
  normalizeDatasetId,
} from './list-classification.config';

describe('REGRESSION: the substring classifier under-reported sanctions hits', () => {
  // The original implementation asked whether the dataset name contained the
  // word "sanction". Both of these are sanctions lists; neither contains it.
  // They were classified WATCHLIST, understating a sanctions match — the
  // direction with legal consequences.
  it.each(['us_ofac_sdn', 'eu_fsf'])(
    '%s is SANCTIONS, not WATCHLIST',
    (dataset) => {
      const result = classifyList({ datasets: [dataset] });
      expect(result.listType).toBe('SANCTIONS');
      expect(result.basis).toBe('dataset');
    },
  );

  it('does not classify by substring in the other direction either', () => {
    // A substring test would have called this sanctions. Exact matching does
    // not, and reports it as unrecognised so an operator can decide.
    const result = classifyList({ datasets: ['no_sanctions_screening_notes'] });
    expect(result.listType).toBe('WATCHLIST');
    expect(result.basis).toBe('unrecognised');
    expect(result.unrecognisedDatasets).toEqual([
      'no_sanctions_screening_notes',
    ]);
  });
});

describe('every registered dataset classifies as its declared type', () => {
  // Pins the whole table: adding an entry without deciding its type, or
  // changing one by accident, fails here.
  it.each(knownDatasetIds())('%s', (id) => {
    expect(classifyList({ datasets: [id] })).toMatchObject({
      listType: DATASET_LIST_TYPES[id],
      basis: 'dataset',
    });
  });

  it("covers this repository's own two synced sources", () => {
    // `WatchlistSource` has exactly these two, and both are sanctions lists.
    expect(classifyList({ datasets: ['OFAC_SDN'] }).listType).toBe('SANCTIONS');
    expect(classifyList({ datasets: ['UN_CONSOLIDATED'] }).listType).toBe(
      'SANCTIONS',
    );
  });

  it('classifies each supported sanctions regime', () => {
    for (const id of [
      'us_ofac_sdn',
      'us_ofac_cons',
      'eu_fsf',
      'un_sc_sanctions',
      'gb_hmt_sanctions',
      'ch_seco_sanctions',
      'ca_dfatd_sema_sanctions',
      'au_dfat_sanctions',
    ]) {
      expect(classifyList({ datasets: [id] }).listType, id).toBe('SANCTIONS');
    }
  });

  it('classifies PEP datasets as PEP', () => {
    for (const id of ['peps', 'wd_peps', 'everypolitician']) {
      expect(classifyList({ datasets: [id] }).listType, id).toBe('PEP');
    }
  });
});

describe('provider topics are authoritative over dataset names', () => {
  it('a sanction topic wins even on an unknown dataset', () => {
    const result = classifyList({
      topics: ['sanction'],
      datasets: ['some_private_list'],
    });
    expect(result.listType).toBe('SANCTIONS');
    expect(result.basis).toBe('topic');
  });

  it('role.pep is the ONLY way a candidate becomes PEP by topic', () => {
    expect(classifyList({ topics: ['role.pep'] }).listType).toBe('PEP');
    // "pep" alone is not the tag OpenSanctions uses; it must not be guessed.
    expect(classifyList({ topics: ['pep'] }).listType).toBe('WATCHLIST');
  });

  it('is case- and whitespace-insensitive about topics', () => {
    expect(classifyList({ topics: ['  SANCTION '] }).listType).toBe(
      'SANCTIONS',
    );
  });
});

describe('normalisation of dataset identifiers', () => {
  it('treats separators and case as the same identifier', () => {
    expect(normalizeDatasetId('US-OFAC-SDN')).toBe('us_ofac_sdn');
    expect(normalizeDatasetId('us ofac sdn')).toBe('us_ofac_sdn');
    expect(normalizeDatasetId('us.ofac.sdn')).toBe('us_ofac_sdn');
    expect(normalizeDatasetId('  us__ofac__sdn  ')).toBe('us_ofac_sdn');
  });

  it('classifies regardless of how the identifier was written', () => {
    for (const written of ['US-OFAC-SDN', 'us ofac sdn', 'Us.Ofac.Sdn']) {
      expect(classifyList({ datasets: [written] }).listType, written).toBe(
        'SANCTIONS',
      );
    }
  });
});

describe('several datasets on one candidate', () => {
  it('takes the STRONGEST category — under-reporting is the harmful direction', () => {
    expect(
      classifyList({ datasets: ['wd_peps', 'us_ofac_sdn'] }).listType,
    ).toBe('SANCTIONS');
    expect(classifyList({ datasets: ['wanted', 'wd_peps'] }).listType).toBe(
      'PEP',
    );
  });

  it('ignores unrecognised entries when at least one is known', () => {
    const result = classifyList({
      datasets: ['something_new', 'us_ofac_sdn'],
    });
    expect(result.listType).toBe('SANCTIONS');
    expect(result.basis).toBe('dataset');
  });
});

describe('the safe default', () => {
  it('an unknown dataset is WATCHLIST and is REPORTED as unrecognised', () => {
    // Reported rather than silently defaulted: an operator can then add the
    // identifier to the registry deliberately.
    const result = classifyList({ datasets: ['brand_new_list_2027'] });
    expect(result.listType).toBe('WATCHLIST');
    expect(result.basis).toBe('unrecognised');
    expect(result.unrecognisedDatasets).toEqual(['brand_new_list_2027']);
  });

  it('no topics and no datasets is WATCHLIST, never PEP or SANCTIONS', () => {
    expect(classifyList({}).listType).toBe('WATCHLIST');
  });

  it('NEVER guesses PEP', () => {
    // Calling somebody politically exposed when the data does not say so is
    // fabricating a determination about a real person.
    for (const datasets of [
      ['politically_something'],
      ['pep_like_list'],
      ['unknown'],
      [],
    ]) {
      expect(classifyList({ datasets }).listType, datasets.join()).not.toBe(
        'PEP',
      );
    }
  });
});
