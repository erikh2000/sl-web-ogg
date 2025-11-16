import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'sl-web-ogg',
      formats: ['es', 'cjs'],
      fileName: (format) =>
        format === 'es'
          ? 'sl-web-ogg.es.js'
          : 'sl-web-ogg.cjs'
    },
    sourcemap: true
  }
});