import { describe, expect, it } from 'vitest';
import { getDictionary, getRegisteredLocales, isDefaultDemoMarkdown } from '../src/i18n';
import { enDict } from '../src/i18n/locales/en';
import { esDict } from '../src/i18n/locales/es';

function collectKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) {
    return [prefix];
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const nextPrefix = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      keys.push(...collectKeys(v, nextPrefix));
    } else {
      expect(typeof v, `Expected string at ${nextPrefix}`).toBe('string');
      expect(String(v).trim().length, `Empty translation at ${nextPrefix}`).toBeGreaterThan(0);
      keys.push(nextPrefix);
    }
  }
  return keys.sort();
}

describe('Extensible i18n dictionaries', () => {
  it('registers Spanish and English locales', () => {
    const codes = getRegisteredLocales().map((l) => l.code);
    expect(codes).toContain('es');
    expect(codes).toContain('en');
  });

  it('has identical key sets and non-empty strings across es and en', () => {
    const esKeys = collectKeys(esDict);
    const enKeys = collectKeys(enDict);
    expect(enKeys).toEqual(esKeys);
  });

  it('defines preview and previewShort labels and updated demoMarkdown across locales', () => {
    expect(esDict.views.preview).toBe('Vista Previa');
    expect(esDict.views.previewShort).toBe('Previa');
    expect(enDict.views.preview).toBe('Preview');
    expect(enDict.views.previewShort).toBe('Preview');
    expect(getDictionary('es').views.preview).toBe('Vista Previa');
    expect(getDictionary('en').views.preview).toBe('Preview');

    expect(esDict.demoMarkdown).toContain('Vista Previa');
    expect(esDict.demoMarkdown).toContain('B -->|Previa| D[WYSIWYG + Tablas + /comandos]');
    expect(esDict.demoMarkdown).toContain('- [ ] Abre una carpeta local');
    expect(esDict.demoMarkdown).not.toContain('Humana');

    expect(enDict.demoMarkdown).toContain('Preview');
    expect(enDict.demoMarkdown).toContain('B -->|Preview| D[WYSIWYG + Tables + /commands]');
    expect(enDict.demoMarkdown).not.toContain('Human');
  });

  it('detects registered default demoMarkdown strings via isDefaultDemoMarkdown', () => {
    expect(isDefaultDemoMarkdown(esDict.demoMarkdown)).toBe(true);
    expect(isDefaultDemoMarkdown(enDict.demoMarkdown)).toBe(true);
    expect(isDefaultDemoMarkdown('# Custom user note')).toBe(false);
    expect(isDefaultDemoMarkdown('')).toBe(false);
  });
});
