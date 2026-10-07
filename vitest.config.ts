import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB integration tests share one PostgreSQL schema: run files one at a time.
    fileParallelism: false,
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
  },
});
