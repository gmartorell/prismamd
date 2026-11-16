import { describe, expect, it } from 'vitest';
import { applyReleaseToChangelog, computeNextDailyVersion } from '../scripts/release.mjs';

describe('CalVer año.mes.dia.versiondiaria release automation', () => {
  it('increments daily version on same date and resets to 1 on a new day', () => {
    const sample = `# Changelog

## [Unreleased]

## [2026.11.15.1] - 2026-11-15

### Añadido
- Versión inicial.
`;
    const sameDay = computeNextDailyVersion(sample, new Date(2026, 10, 15, 18, 0, 0));
    expect(sameDay).toEqual({ version: '2026.11.15.2', isoDate: '2026-11-15' });

    const nextDay = computeNextDailyVersion(sample, new Date(2026, 10, 16, 9, 0, 0));
    expect(nextDay).toEqual({ version: '2026.11.16.1', isoDate: '2026-11-16' });

    const singleDigitDate = computeNextDailyVersion(sample, new Date(2026, 0, 5, 10, 0, 0));
    expect(singleDigitDate).toEqual({ version: '2026.1.5.1', isoDate: '2026-01-05' });
  });

  it('promotes [Unreleased] content cleanly into the new dated version header', () => {
    const changelog = `# Changelog

## [Unreleased]

### Corregido
- Ajuste de scroll sincronizado.

## [2026.11.15.1] - 2026-11-15

### Añadido
- Base inicial.
`;
    const updated = applyReleaseToChangelog(changelog, '2026.11.15.2', '2026-11-15');
    expect(updated).toContain('## [Unreleased]\n\n## [2026.11.15.2] - 2026-11-15');
    expect(updated).toContain('- Ajuste de scroll sincronizado.');
    expect(updated).toContain('## [2026.11.15.1] - 2026-11-15');
  });
});
