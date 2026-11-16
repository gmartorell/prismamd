import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyReleaseToChangelog,
  compareCalVer,
  computeNextDailyVersion,
} from '../scripts/release.mjs';

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

  it('enforces strict monotonicity against existing extension/manifest.json version', () => {
    const sample = `# Changelog

## [Unreleased]

## [2026.11.15.1] - 2026-11-15

### Añadido
- Versión inicial.
`;
    // Same date, manifest ahead of changelog
    const bumpedSameDay = computeNextDailyVersion(
      sample,
      new Date(2026, 10, 15, 18, 0, 0),
      '2026.11.15.4',
    );
    expect(bumpedSameDay).toEqual({ version: '2026.11.15.5', isoDate: '2026-11-15' });
    expect(compareCalVer(bumpedSameDay.version, '2026.11.15.4')).toBe(1);

    // Timezone skew: manifest already on a later calendar date than local clock
    const bumpedFutureTz = computeNextDailyVersion(
      sample,
      new Date(2026, 10, 15, 23, 0, 0),
      '2026.11.16.2',
    );
    expect(bumpedFutureTz).toEqual({ version: '2026.11.16.3', isoDate: '2026-11-16' });
    expect(compareCalVer(bumpedFutureTz.version, '2026.11.16.2')).toBe(1);
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

  it('appends --note entries alongside non-empty [Unreleased] content without dropping either', () => {
    const changelogWithoutCambiado = `# Changelog

## [Unreleased]

### Corregido
- Corrección de sincronización.

## [2026.11.15.1] - 2026-11-15
`;
    const mergedNewSection = applyReleaseToChangelog(
      changelogWithoutCambiado,
      '2026.11.15.2',
      '2026-11-15',
      ['Optimización de precarga PWA.'],
    );
    expect(mergedNewSection).toContain('### Corregido\n- Corrección de sincronización.');
    expect(mergedNewSection).toContain('### Cambiado\n- Optimización de precarga PWA.');

    const changelogWithCambiado = `# Changelog

## [Unreleased]

### Cambiado
- Separación de chunks de Mermaid.

### Corregido
- Corrección de sincronización.

## [2026.11.15.1] - 2026-11-15
`;
    const mergedExistingSection = applyReleaseToChangelog(
      changelogWithCambiado,
      '2026.11.15.2',
      '2026-11-15',
      ['Nuevo flag CLI.'],
    );
    expect(mergedExistingSection).toContain(
      '### Cambiado\n- Separación de chunks de Mermaid.\n- Nuevo flag CLI.',
    );
    expect(mergedExistingSection).toContain('### Corregido\n- Corrección de sincronización.');
  });

  it('keeps pwa/sw.js CACHE_NAME template compatible with release.mjs updater', () => {
    const swTemplate = fs.readFileSync(path.join(process.cwd(), 'pwa', 'sw.js'), 'utf8');
    expect(swTemplate).toMatch(/^const CACHE_NAME = 'prismamd-\d+\.\d+\.\d+\.\d+';/m);
  });
});
