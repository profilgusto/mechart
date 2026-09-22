import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/** Raiz do projeto karu-un, um nivel acima da aplicacao. */
const PROJECT = path.resolve(import.meta.dirname, '..')
const COMPONENTS = path.join(PROJECT, 'components.json')
const PORTS = path.join(PROJECT, 'arquitetura', 'ports.json')
const DIAGRAM = path.join(PROJECT, 'arquitetura', 'diagrama.json')

const readIfExists = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)

/**
 * Serve os dados do projeto (que vivem fora da raiz do Vite) e grava o diagrama
 * de volta em disco. O components.json e sempre somente leitura.
 */
function projectData(): Plugin {
  return {
    name: 'karu-project-data',
    configureServer(server) {
      server.middlewares.use('/api/data', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            componentsRaw: readIfExists(COMPONENTS),
            portsRaw: readIfExists(PORTS),
            diagramRaw: readIfExists(DIAGRAM),
          }),
        )
      })

      server.middlewares.use('/api/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('POST only')
        }
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8')
            JSON.parse(body) // recusa gravar lixo
            fs.mkdirSync(path.dirname(DIAGRAM), { recursive: true })
            fs.writeFileSync(DIAGRAM, body, 'utf8')
            res.setHeader('Content-Type', 'application/json')
            res.end('{"ok":true}')
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: String(err) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), projectData()],
  server: {
    port: 5180,
    // Dentro do container precisa escutar em 0.0.0.0 para o Mac alcancar a porta.
    host: true,
    // Bind mount do macOS nao propaga eventos de inotify: sem polling o HMR
    // nao ve as edicoes feitas no editor do host.
    watch: process.env.KARU_POLL ? { usePolling: true, interval: 300 } : undefined,
  },
})
