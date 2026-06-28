// Tell React the test runner drives renders inside act(), so it doesn't warn about
// "environment not configured to support act(...)" when components are tested with
// react-dom/client + act (the repo has no React Testing Library).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Pin the UI locale to Chinese for the suite. These component tests were written asserting the Chinese
// strings and verify behavior, not the default-language choice (English default + detection is covered
// separately by test/i18n.test.js). i18n reads this at module load, and setupFiles run before the test
// modules import it, so the locale is fixed before any component resolves t().
try { localStorage.setItem('tw_lang', 'zh'); } catch { /* no localStorage in this env */ }

// Pin ASR as available so component suites render the mic button (its absence on keyless installs is a
// separate concern, covered by test/useAsrAvailable.test.jsx). useAsrAvailable reads this as its cached
// initial value before the /api/config refresh resolves.
try { localStorage.setItem('tw_asr', '1'); } catch { /* no localStorage in this env */ }
