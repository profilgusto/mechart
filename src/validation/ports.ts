import type { Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { nodeLabel } from '../model/graph'

/** Respeita o numero de ligacoes que cada porta aceita, e a exclusividade mutua. */
export function checkPortCount(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Issue[] {
  const issues: Issue[] = []

  // (nodeId, portId) -> arestas
  const used = new Map<string, string[]>()
  const key = (n: string, p: string) => `${n}\u0000${p}`
  const touch = (n: string, p: string, edgeId: string) => {
    const k = key(n, p)
    used.set(k, [...(used.get(k) ?? []), edgeId])
  }

  for (const e of edges) {
    touch(e.source, e.sourcePort, e.id)
    touch(e.target, e.targetPort, e.id)
  }

  for (const node of nodes) {
    const component = lib.byId[node.componentId]
    if (!component) continue
    const label = nodeLabel(node, component)

    for (const port of component.ports) {
      const edgeIds = used.get(key(node.id, port.id)) ?? []

      if (edgeIds.length > port.count) {
        issues.push({
          level: 'error',
          rule: 'port-count',
          message: `${label}.${port.id}: ${edgeIds.length} ligações numa porta que aceita ${port.count}.`,
          nodeIds: [node.id],
          edgeIds,
        })
      }

      if (edgeIds.length > 0 && port.exclusiveWith?.length) {
        const conflitos = port.exclusiveWith.filter(
          (other) => (used.get(key(node.id, other)) ?? []).length > 0,
        )
        // Reporta o conflito uma vez so, a partir da porta de id menor.
        for (const other of conflitos) {
          if (port.id < other) {
            issues.push({
              level: 'error',
              rule: 'port-count',
              message: `${label}: ${port.id} e ${other} são mutuamente exclusivos — o componente usa um ou o outro, não os dois.`,
              nodeIds: [node.id],
              edgeIds: [...edgeIds, ...(used.get(key(node.id, other)) ?? [])],
            })
          }
        }
      }
    }
  }

  return issues
}
