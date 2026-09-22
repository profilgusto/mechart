import type { Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { resolveEdge, nodeLabel } from '../model/graph'

/**
 * Algumas portas so fazem sentido num ponto especifico da topologia. O lado
 * B+/B- de um BMS, por exemplo, e para as celulas: qualquer outra coisa ligada
 * ali passa por fora dos MOSFETs de protecao.
 */
export function checkTopology(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Issue[] {
  const issues: Issue[] = []

  for (const edge of edges) {
    const r = resolveEdge(lib, nodes, edge)
    if (!r) continue

    for (const [lado, outro] of [
      [r.from, r.to],
      [r.to, r.from],
    ] as const) {
      const { only, onlyNote } = lado.port
      if (!only?.length) continue
      if (only.includes(outro.component.id)) continue

      const esperado = only.join(' ou ')
      issues.push({
        level: 'warning',
        rule: 'topology',
        message:
          `${nodeLabel(lado.node, lado.component)}.${lado.port.id} espera ${esperado} do outro lado, ` +
          `mas está ligado a ${nodeLabel(outro.node, outro.component)}.` +
          (onlyNote ? ` ${onlyNote}` : ''),
        nodeIds: [lado.node.id, outro.node.id],
        edgeIds: [edge.id],
      })
    }
  }

  return issues
}
