import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPendingUpdate,
  checkForAppUpdates,
  compareVersions,
  getCurrentVersion,
} from '../src/utils/version';

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
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        json: async () => ({ version: '2026.11.15.99', buildHash: 'a1b2c3d4', target: 'pwa' }),
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

  it('does not misreport offline when dev/SPA server returns 200 text/html for version.json', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });

    const jsonSpy = vi.fn(async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        json: jsonSpy,
      })),
    );

    const res = await checkForAppUpdates('2026.11.15.5');
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(res).toEqual({
      status: 'up-to-date',
      currentVersion: '2026.11.15.5',
      latestVersion: '2026.11.15.5',
    });
  });

  it('falls back cleanly instead of reporting offline if version.json returns malformed JSON without headers', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
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

  it('promotes waiting SW via SKIP_WAITING without wiping prismamd-* CacheStorage entries', async () => {
    const deleteCacheSpy = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['prismamd-2026.11.16.1-aaaa1111', 'prismamd-2026.11.16.2-bbbb2222']),
      delete: deleteCacheSpy,
    });

    const postMessageSpy = vi.fn();
    let controllerChangeHandler: (() => void) | null = null;

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          active: { state: 'activated' },
          waiting: { state: 'installed', postMessage: postMessageSpy },
          update: vi.fn(async () => undefined),
        })),
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (event === 'controllerchange') {
            controllerChangeHandler = cb;
          }
        }),
      },
    });

    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    await applyPendingUpdate();

    expect(deleteCacheSpy).not.toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(controllerChangeHandler).toBeTypeOf('function');
    controllerChangeHandler!();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
