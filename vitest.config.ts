import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['test/**/*.test.ts'],
    // Isolated $FLOWLENS_HOME per test file; stops daemons started there.
    setupFiles: ['test/setup/flowlens-home.ts'],
    testTimeout: 10000,
  },
});
