import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1800 },
  test: {
    // Unit tests only. The rules tests in tests/rules need the emulator: npm run test:rules
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
})
