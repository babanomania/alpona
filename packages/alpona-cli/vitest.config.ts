import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'alpona-cli',
    include: ['test/**/*.test.ts'],
  },
});
