import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  // Bundle workspace packages so the Docker image needs only external npm deps
  noExternal: [/^@psst\//],
  sourcemap: false,
  clean: true,
});
