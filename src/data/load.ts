import type { Component, Library, PortSpec } from '../model/types'
import type { ComponentType } from '../model/component-type'
import { parseLibraryFile } from './parse'
import { categoryOf } from './normalize'
import { readStoredProject, type ProjectFile } from './project'

// O catalogo e as portas sao embutidos no bundle em tempo de build (`?raw`).
// O site e 100% estatico: nao existe servidor nem endpoint /api, entao os dados
// do projeto viajam dentro do proprio JavaScript gerado por `npm run build`.
import libraryRaw from '../../data/library.json?raw'
import portsRaw from '../../data/ports.json?raw'

export type LoadResult = {
  library: Library
  project: ProjectFile | null
}

export async function loadProject(): Promise<LoadResult> {
  const { components: rawComponents, units } = parseLibraryFile(libraryRaw)

  const portSpecs = JSON.parse(portsRaw) as Record<string, PortSpec>

  const components: Component[] = Object.entries(rawComponents).map(([id, raw]) => {
    const spec = portSpecs[id]

    // Extrai o tipo hierárquico (string ou objeto)
    const type: ComponentType = raw.type as ComponentType || 'unknown'

    return {
      id,
      description: typeof raw.description === 'string' ? raw.description : id,
      category: spec?.category ?? categoryOf(id),
      type,
      raw,
      ports: spec?.ports ?? [],
      instance: spec?.instance ?? {},
      external: false,
    }
  })

  // Fontes externas: nao existem na library.json porque nao sao pecas do
  // projeto. Sao fronteiras do sistema, declaradas so no ports.json -- e por
  // isso ficam marcadas como `external` e fora do BOM.
  for (const [id, spec] of Object.entries(portSpecs)) {
    if (!spec.external || rawComponents[id]) continue
    const description =
      spec.description ?? 'Alimentação fornecida de fora do projeto — não é uma peça do sistema.'
    const type = spec.type ?? 'Fonte externa'
    components.push({
      id,
      description,
      category: spec.category ?? 'external',
      type,
      raw: { description, type },
      ports: spec.ports,
      instance: spec.instance ?? {},
      external: true,
    })
  }

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
