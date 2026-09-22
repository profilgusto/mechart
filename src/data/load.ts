import type { Component, Library, PortSpec } from '../model/types'
import type { ComponentType } from '../model/component-type'
import { parseComponentsFile } from './parse'
import { categoryOf } from './normalize'

type ApiPayload = {
  componentsRaw: string | null
  portsRaw: string | null
  diagramRaw: string | null
}

export type LoadResult = {
  library: Library
  diagram: unknown | null
}

export async function loadProject(): Promise<LoadResult> {
  const res = await fetch('/api/data')
  if (!res.ok) throw new Error(`/api/data respondeu ${res.status}`)
  const payload = (await res.json()) as ApiPayload

  if (!payload.componentsRaw) {
    throw new Error('components.json não encontrado na raiz do projeto')
  }

  const { components: rawComponents, units } = parseComponentsFile(payload.componentsRaw)

  const portSpecs: Record<string, PortSpec> = payload.portsRaw
    ? (JSON.parse(payload.portsRaw) as Record<string, PortSpec>)
    : {}

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
    }
  })

  const byId: Record<string, Component> = {}
  for (const c of components) byId[c.id] = c

  return {
    library: {
      components,
      byId,
      units,
      missingPorts: components.filter((c) => c.ports.length === 0).map((c) => c.id),
    },
    diagram: payload.diagramRaw ? JSON.parse(payload.diagramRaw) : null,
  }
}

export async function saveDiagram(diagram: unknown): Promise<void> {
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagram, null, 2),
  })
  if (!res.ok) throw new Error(`falha ao salvar: ${res.status}`)
}
