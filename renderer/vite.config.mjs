import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Builds the launcher window into src/ui, which Electron loads from disk.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../src/ui', import.meta.url)),
    emptyOutDir: true,
  },
});
