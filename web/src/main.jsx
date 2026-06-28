import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { registerServiceWorker } from './sw-register.js';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
registerServiceWorker();

// Fade out the inline boot splash once React has painted AND the app CSS is ready.
// asyncAppCss (vite.config.js) loads the stylesheet with media="print" so it doesn't block the
// splash's first paint. The tradeoff: if CSS hasn't arrived by the time React mounts, hiding the
// splash immediately reveals an unstyled page. We wait for the link's load event to be safe.
if (typeof window !== 'undefined' && window.__hideBootSplash) {
  const cssLinks = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(l => l.media === 'print');
  const waitCss = cssLinks.length
    ? new Promise(res => { let n = cssLinks.length; cssLinks.forEach(l => l.addEventListener('load', () => { if (!--n) res(); }, { once: true })); })
    : Promise.resolve();
  requestAnimationFrame(() => requestAnimationFrame(() => waitCss.then(() => window.__hideBootSplash())));
}
