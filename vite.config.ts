import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // PORT lets a second dev server run beside one that already holds 5180.
  server: { port: Number(process.env.PORT) || 5180 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
