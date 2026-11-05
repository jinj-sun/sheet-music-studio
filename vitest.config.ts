import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,mjs}'],
    setupFiles: ['tests/unit/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
