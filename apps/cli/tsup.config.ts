import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'es2022',
  banner: {
    js: '#!/usr/bin/env node',
  },
  clean: true,
  // Bundle all workspace packages (they ship as .ts source, not pre-built)
  noExternal: ['@psst/crypto', '@psst/shared', '@psst/api'],
});
