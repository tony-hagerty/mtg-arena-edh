import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
