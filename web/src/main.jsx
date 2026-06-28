import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { registerServiceWorker } from './sw-register.js';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
registerServiceWorker();

// Fade out the inline boot splash (index.html) once React has actually painted — two rAFs to clear the
// commit + paint, then the splash's own min-show timer keeps it visible long enough to read.
if (typeof window !== 'undefined' && window.__hideBootSplash) {
  requestAnimationFrame(() => requestAnimationFrame(() => window.__hideBootSplash()));
}
