import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Site 100% estatico: `npm run build` gera dist/, que qualquer host estatico
// (ou o nginx do Dockerfile) serve. Nao ha endpoints /api -- o catalogo e as
// portas entram no bundle via `?raw` (ver src/data/load.ts) e o projeto do
// usuario vive no localStorage e no JSON baixado.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
  },
})
