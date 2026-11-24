import { defineConfig } from 'vitest/config'

// Rules tests need the Firestore emulator. Run them with `npm run test:rules`, which starts it.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    // Every file shares one emulator, so they run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
