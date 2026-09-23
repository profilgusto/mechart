import type { Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { nodeLabel, missingRequired } from '../model/graph'

/**
 * Portas marcadas como obrigatorias e que ninguem ligou. E a resposta a
 * "o que ainda falta para isto funcionar". Portas mutuamente exclusivas contam
 * como um grupo alternativo: uma entrada USB-C ou os pinos 5 V do header.
 */
export function checkMissing(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Issue[] {
  const usadas = new Set<string>()
  for (const e of edges) {
    usadas.add(`${e.source}\u0000${e.sourcePort}`)
    usadas.add(`${e.target}\u0000${e.targetPort}`)
  }

  const issues: Issue[] = []

  for (const node of nodes) {
    const component = lib.byId[node.componentId]
    if (!component) continue

    const connected = new Set(
      component.ports
        .filter((p) => usadas.has(`${node.id}\u0000${p.id}`))
        .map((p) => p.id),
    )
    const grupos = missingRequired(component, connected)
    if (grupos.length === 0) continue

    const nomes = grupos
      .map((g) => g.map((p) => p.label ?? p.id).join(' ou '))
      .join(', ')
    issues.push({
      level: 'warning',
      rule: 'missing',
      message: `${nodeLabel(node, component)}: falta ligar ${nomes} — sem isso o componente não funciona.`,
      nodeIds: [node.id],
    })
  }

  return issues
}
