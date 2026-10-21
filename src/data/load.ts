import type { Component, Library } from '../model/types'
import { parseComponentFile, toComponent } from './catalog'
import { categoryOf } from './normalize'
import { readStoredProject, type ProjectFile } from './project'

// O catalogo e embutido no bundle em tempo de build (`?raw`): um arquivo por
// componente em data/components/. O site e 100% estatico -- nao existe servidor
// nem endpoint /api, entao os dados viajam dentro do JavaScript gerado por
// `npm run build`.
import unitsRaw from '../../data/units.json?raw'

const componentFiles = import.meta.glob('../../data/components/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

export type LoadResult = {
  library: Library
  project: ProjectFile | null
}

export async function loadProject(): Promise<LoadResult> {
  const units = JSON.parse(unitsRaw) as Record<string, string>

  // Fontes externas (`external: true`) tambem sao arquivos do catalogo: sao
  // fronteiras do sistema, nao pecas, e por isso ficam fora do BOM.
  const components: Component[] = Object.entries(componentFiles)
    .map(([path, text]) => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      const file = parseComponentFile(text, name)
      if (name !== `${file.id}.json`) {
        throw new Error(`${name}: o nome do arquivo deve ser "${file.id}.json"`)
      }
      return toComponent(file, categoryOf)
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const byId: Record<string, Component> = {}
  for (const c of components) byId[c.id] = c

  // O projeto em edicao no navegador e a unica fonte: e onde o usuario parou.
  // Sem servidor, nao ha copia em disco -- so o localStorage e o download.
  const project = readStoredProject()

  return {
    library: {
      components,
      byId,
      units,
      missingPorts: components.filter((c) => c.ports.length === 0).map((c) => c.id),
    },
    project,
  }
}
