import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
    // The dev server happily serves the project root, and the workshop-code
    // store lives under it. Belt and braces on top of the dot-directory.
    fs: { deny: ['.env', '.env.*', 'server/.data/**', '**/server/.data/**'] },
  },
  test: {
    // Vitest owns the unit suites under src/. The suites under e2e/ belong to
    // Playwright and must not be collected here.
    include: ['src/**/*.test.{ts,tsx}'],
    // Only the component suites need a DOM; the rest are plain modules and
    // say so with their own `@vitest-environment node` where it matters.
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
  },
})
