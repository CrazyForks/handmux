import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    // notifications.test.js uses node:test directly (module-singleton reload via a fully-dynamic
    // `import(\`...?t=${Date.now()}\`)` per test, so each test sees a fresh in-memory store). Vite's
    // static import-analysis can't resolve that expression ("Unknown variable dynamic import"), so this
    // file is excluded here and run separately via `node --test test/notifications.test.js`.
    exclude: ['test/notifications.test.js'],
    // Run test files sequentially. Many suites use supertest, which spins up an ephemeral HTTP server per
    // request; under parallel file execution the box oversaturates and superagent intermittently reads a
    // malformed response ("Parse Error: Expected HTTP/", or a spurious 403) — a harness-only flake (~1/5
    // full runs) that never reflects a real route bug. Sequential is ~3x slower (≈21s vs ≈8s) but green
    // every run. Verified: 0 flakes across repeated sequential runs.
    fileParallelism: false,
  },
});
