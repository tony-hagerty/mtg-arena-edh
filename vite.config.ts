import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  // `--mode single` (npm run build:single) inlines all JS, CSS and fonts into one
  // index.html that works when opened straight from disk (file://).
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
  // PORT lets a second dev server run beside one that already holds 5180.
  server: { port: Number(process.env.PORT) || 5180 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
}));
