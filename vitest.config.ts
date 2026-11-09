import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: {
    '@lily-on-eink/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    '@lily-on-eink/engine-wasm': fileURLToPath(new URL('./packages/engine-wasm/src/index.ts', import.meta.url)),
  } },
  test: { include: ['packages/*/test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 60_000,
          fileParallelism: false },  // never two WASM engines at once
});
