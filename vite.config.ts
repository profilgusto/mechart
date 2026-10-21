import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Site 100% estatico: `npm run build` gera dist/, que qualquer host estatico
// (ou o nginx do Dockerfile) serve. Nao ha endpoints /api -- o catalogo
// (data/components/*.json) entra no bundle via `?raw` (ver src/data/load.ts) e o projeto do
// usuario vive no localStorage e no JSON baixado.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // No Docker (Mac) os eventos de arquivo do bind mount nao chegam; ver docker-compose.yml.
    watch: process.env.CHOKIDAR_USEPOLLING ? { usePolling: true, interval: 300 } : undefined,
  },
})
