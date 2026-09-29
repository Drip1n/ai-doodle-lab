import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Vitest owns the unit suites under src/. The suites under e2e/ belong to
    // Playwright and must not be collected here.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
