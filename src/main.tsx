import { render } from 'preact';
import { App } from './App';
import './styles/app.css';

declare const __BUILD_TARGET__: 'pwa' | 'extension';

render(<App />, document.getElementById('app')!);

if (
  __BUILD_TARGET__ === 'pwa' &&
  typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:')
) {
  const manifestLink = document.createElement('link');
  manifestLink.rel = 'manifest';
  manifestLink.href = './manifest.webmanifest';
  document.head.appendChild(manifestLink);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          const scheduleIdle =
            typeof window.requestIdleCallback === 'function'
              ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 4000 })
              : (cb: () => void) => window.setTimeout(cb, 1500);
          scheduleIdle(() => {
            reg.active?.postMessage({ type: 'WARM_LAZY_ASSETS' });
          });
        })
        .catch(() => undefined);
    });
  }
}
