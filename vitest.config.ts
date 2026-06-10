import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    env: { LOG_LEVEL: 'error', NODE_ENV: 'test' },
    // Default discovery (root-relative) so the same config works from the repo
    // root AND from any package's cwd under turbo.
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**', 'apps/**/src/**'],
      exclude: ['**/*.test.ts', '**/dist/**'],
    },
  },
  resolve: {
    // Allow `import './x.js'` to resolve to './x.ts' in source.
    extensions: ['.ts', '.tsx', '.js', '.json'],
  },
});
