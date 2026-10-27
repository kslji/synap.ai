import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  // Greyscale text rasterisation differs a little between macOS and the Ubuntu runner
  // even with the same font, so allow three percent of pixels to drift before a
  // snapshot counts as a regression.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.03, animations: 'disabled' } },
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
})
