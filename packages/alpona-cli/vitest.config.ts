import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'alpona-db',
    include: ['test/**/*.test.ts'],
  },
});
