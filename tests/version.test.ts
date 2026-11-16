import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForAppUpdates, compareVersions, getCurrentVersion } from '../src/utils/version';

describe('version utilities and update detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('compares CalVer version strings numerically', () => {
    expect(compareVersions('2026.11.15.6', '2026.11.15.5')).toBe(1);
    expect(compareVersions('2026.11.15.10', '2026.11.15.2')).toBe(1);
    expect(compareVersions('2026.11.15.5', '2026.11.15.5')).toBe(0);
    expect(compareVersions('v2026.11.15-5', '2026.11.15.5')).toBe(0);
    expect(compareVersions('2026.11.15.4', '2026.11.15.5')).toBe(-1);
    expect(compareVersions('2026.12.1.1', '2026.11.30.9')).toBe(1);
  });

  it('exposes the current build version cleanly', () => {
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('detects newer version from same-origin version.json in PWA mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '2026.11.15.99', target: 'pwa' }),
      })),
    );

    const res = await checkForAppUpdates('2026.11.15.5');
    expect(res).toEqual({
      status: 'update-available',
      currentVersion: '2026.11.15.5',
      latestVersion: '2026.11.15.99',
      canApplyReload: true,
    });
  });

  it('reports up-to-date when remote version matches current version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '2026.11.15.5', target: 'pwa' }),
      })),
    );

    const res = await checkForAppUpdates('2026.11.15.5');
    expect(res).toEqual({
      status: 'up-to-date',
      currentVersion: '2026.11.15.5',
      latestVersion: '2026.11.15.5',
    });
  });

  it('reports up-to-date when remote version matches even if a service worker is waiting', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          active: { state: 'activated' },
          waiting: { state: 'installed' },
          update: vi.fn(async () => undefined),
        })),
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '2026.11.15.5', target: 'pwa' }),
      })),
    );

    const res = await checkForAppUpdates('2026.11.15.5');
    expect(res).toEqual({
      status: 'up-to-date',
      currentVersion: '2026.11.15.5',
      latestVersion: '2026.11.15.5',
    });
  });

  it('reports offline gracefully when version.json fetch fails without network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const res = await checkForAppUpdates('2026.11.15.5');
    expect(res).toEqual({
      status: 'offline',
      currentVersion: '2026.11.15.5',
    });
  });
});
