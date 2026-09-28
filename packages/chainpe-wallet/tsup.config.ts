import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
  // Bundle the SDK so the published server / .mcpb doesn't depend on a
  // matching @chainpe/sdk release.
  noExternal: ['@chainpe/sdk'],
  banner: {
    js: '#!/usr/bin/env node'
  }
})
