import { defineConfig } from 'vite';

// Vite 8 runs on Rolldown, where the `manualChunks` object form throws and the
// function form is silently ignored. `advancedChunks` is the native API.
export default defineConfig({
  build: {
    target: 'es2022',
    // three is ~857 kB raw in its own long-lived cacheable chunk. That is the
    // floor for this kind of site, not something to warn about every build.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'motion', test: /[\\/]node_modules[\\/](gsap|lenis)[\\/]/ },
          ],
        },
      },
    },
  },
});
