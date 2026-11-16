declare const __APP_VERSION__: string | undefined;
declare const __BUILD_TARGET__: 'pwa' | 'extension' | undefined;

export type RuntimeChannel = 'pwa' | 'extension';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'offline'
  | 'managed-by-store';

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  canApplyReload?: boolean;
}

interface ChromeRuntimeLike {
  getManifest?: () => { version?: string };
  reload?: () => void;
  requestUpdateCheck?: (
    callback: (status: string, details?: { version?: string }) => void,
  ) => void;
}

function getChromeRuntime(): ChromeRuntimeLike | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  const g = globalThis as { chrome?: { runtime?: ChromeRuntimeLike } };
  return g.chrome?.runtime;
}

export function getRuntimeChannel(): RuntimeChannel {
  return typeof __BUILD_TARGET__ !== 'undefined' && __BUILD_TARGET__ === 'extension'
    ? 'extension'
    : 'pwa';
}

export function getCurrentVersion(): string {
  if (getRuntimeChannel() === 'extension') {
    try {
      const manifestVersion = getChromeRuntime()?.getManifest?.()?.version;
      if (manifestVersion && manifestVersion.trim()) return manifestVersion.trim();
    } catch {
      // Ignore outside extension runtime
    }
  }
  return typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0.0';
}

/**
 * Compares two numeric CalVer strings such as `2026.11.15.5` vs `2026.11.15.6`.
 * Returns 1 when `a > b`, -1 when `a < b`, or 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (val: string) =>
    val
      .trim()
      .replace(/^v/i, '')
      .replace(/-/g, '.')
      .split('.')
      .map((part) => {
        const num = Number.parseInt(part, 10);
        return Number.isFinite(num) ? num : 0;
      });

  const partsA = parse(a);
  const partsB = parse(b);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i += 1) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/**
 * Checks for updates using strictly local/same-origin browser mechanisms:
 * - PWA (`http:`/`https:`): same-origin `./version.json` (`no-store`) + Service Worker update check
 * - Chromium extension: `chrome.runtime.requestUpdateCheck` when available
 */
export async function checkForAppUpdates(currentVersion = getCurrentVersion()): Promise<UpdateCheckResult> {
  if (getRuntimeChannel() === 'extension') {
    const runtime = getChromeRuntime();
    if (typeof runtime?.requestUpdateCheck === 'function') {
      return await new Promise<UpdateCheckResult>((resolve) => {
        try {
          runtime.requestUpdateCheck!((status, details) => {
            if (
              status === 'update_available' &&
              (!details?.version || compareVersions(details.version, currentVersion) > 0)
            ) {
              resolve({
                status: 'update-available',
                currentVersion,
                latestVersion: details?.version,
                canApplyReload: true,
              });
              return;
            }
            if (status === 'no_update' || status === 'update_available') {
              resolve({ status: 'up-to-date', currentVersion, latestVersion: currentVersion });
              return;
            }
            resolve({ status: 'managed-by-store', currentVersion });
          });
        } catch {
          resolve({ status: 'managed-by-store', currentVersion });
        }
      });
    }
    return { status: 'managed-by-store', currentVersion };
  }

  if (typeof window === 'undefined') {
    return { status: 'up-to-date', currentVersion, latestVersion: currentVersion };
  }

  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
    return { status: 'up-to-date', currentVersion, latestVersion: currentVersion };
  }

  let swWaiting = false;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update().catch(() => undefined);
        swWaiting = Boolean(reg.waiting && reg.active && reg.waiting !== reg.active);
      }
    }
  } catch {
    // Ignore SW inspection failures
  }

  try {
    const res = await fetch(`./version.json?_=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const payload = (await res.json()) as { version?: string };
      const remoteVersion = typeof payload?.version === 'string' ? payload.version.trim() : '';
      if (remoteVersion) {
        if (compareVersions(remoteVersion, currentVersion) > 0) {
          return {
            status: 'update-available',
            currentVersion,
            latestVersion: remoteVersion,
            canApplyReload: true,
          };
        }
        return {
          status: 'up-to-date',
          currentVersion,
          latestVersion: remoteVersion,
        };
      }
    }
  } catch {
    return { status: 'offline', currentVersion };
  }

  if (swWaiting) {
    return {
      status: 'update-available',
      currentVersion,
      canApplyReload: true,
    };
  }

  return { status: 'up-to-date', currentVersion, latestVersion: currentVersion };
}

/**
 * Watches active PWA Service Worker registration updates and re-verifies version.json before notifying.
 */
export function subscribePwaUpdateReady(onResult: (result: UpdateCheckResult) => void): () => void {
  if (
    getRuntimeChannel() !== 'pwa' ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    (window.location.protocol !== 'http:' && window.location.protocol !== 'https:')
  ) {
    return () => {};
  }

  let disposed = false;
  let trackedReg: ServiceWorkerRegistration | null = null;
  let trackedInstalling: ServiceWorker | null = null;

  const verifyRemoteVersion = () => {
    void checkForAppUpdates(getCurrentVersion()).then((res) => {
      if (!disposed && res.status === 'update-available') {
        onResult(res);
      }
    });
  };

  const onStateChange = () => {
    if (!disposed && trackedInstalling?.state === 'installed' && navigator.serviceWorker.controller) {
      verifyRemoteVersion();
    }
  };

  const onUpdateFound = () => {
    if (!trackedReg) return;
    if (trackedInstalling) {
      trackedInstalling.removeEventListener('statechange', onStateChange);
    }
    trackedInstalling = trackedReg.installing;
    trackedInstalling?.addEventListener('statechange', onStateChange);
  };

  void navigator.serviceWorker
    .getRegistration()
    .then((reg) => {
      if (disposed || !reg) return;
      trackedReg = reg;
      if (reg.waiting) {
        verifyRemoteVersion();
      }
      reg.addEventListener('updatefound', onUpdateFound);
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    trackedReg?.removeEventListener('updatefound', onUpdateFound);
    trackedInstalling?.removeEventListener('statechange', onStateChange);
  };
}

/**
 * Applies a pending update by promoting a waiting Service Worker, clearing stale caches, and reloading.
 */
export async function applyPendingUpdate(): Promise<void> {
  if (getRuntimeChannel() === 'extension') {
    const runtime = getChromeRuntime();
    if (typeof runtime?.reload === 'function') {
      runtime.reload();
      return;
    }
  }

  if (typeof window === 'undefined') return;

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith('prismamd-')).map((key) => caches.delete(key)),
      );
    }
  } catch {
    // Ignore cache clear issues
  }

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) {
        let reloaded = false;
        const reloadOnce = () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        window.setTimeout(reloadOnce, 1200);
        return;
      }
      await reg?.update().catch(() => undefined);
    } catch {
      // Fallback to direct reload below
    }
  }

  window.location.reload();
}
