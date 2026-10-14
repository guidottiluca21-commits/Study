import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: funziona su GitHub Pages sia con dominio utente.github.io/repo/ sia in locale
export default defineConfig({
  base: './',
  root: 'src/web',
  publicDir: '../../public',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: { port: 5173 },
});
