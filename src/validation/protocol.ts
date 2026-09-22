import type { Issue, Library, Port } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { resolveEdge, nodeLabel } from '../model/graph'

/** Um par de portas de dados so pode ser ligado se falar o mesmo protocolo. */
export function portsCompatible(a: Port, b: Port): { ok: boolean; reason?: string } {
  if (a.kind !== b.kind) {
    return { ok: false, reason: 'uma porta é de energia e a outra de dados' }
  }
  if (a.kind === 'power') {
    // 'bidir' e a porta comum de um BMS (P+/P-), onde carga e carregador
    // compartilham os mesmos terminais: ora entrega corrente, ora recebe.
    const aFornece = a.dir === 'source' || a.dir === 'bidir'
    const bConsome = b.dir === 'sink' || b.dir === 'bidir'
    if (!aFornece || !bConsome) {
      return { ok: false, reason: 'ligue sempre uma saída de energia numa entrada' }
    }
    return { ok: true }
  }
  if (a.protocol !== b.protocol) {
    return { ok: false, reason: `${a.protocol ?? '?'} não conversa com ${b.protocol ?? '?'}` }
  }
  const aOut = a.dir === 'out' || a.dir === 'bidir'
  const bIn = b.dir === 'in' || b.dir === 'bidir'
  if (!aOut || !bIn) {
    return { ok: false, reason: 'sentido incompatível (saída → entrada)' }
  }
  return { ok: true }
}

export function checkProtocol(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Issue[] {
  const issues: Issue[] = []

  for (const edge of edges) {
    const r = resolveEdge(lib, nodes, edge)
    if (!r) continue
    const { from, to } = r

    const verdict = portsCompatible(from.port, to.port)
    if (!verdict.ok) {
      issues.push({
        level: 'error',
        rule: 'protocol',
        message: `${nodeLabel(from.node, from.component)}.${from.port.id} → ${nodeLabel(to.node, to.component)}.${to.port.id}: ${verdict.reason}.`,
        nodeIds: [from.node.id, to.node.id],
        edgeIds: [edge.id],
      })
      continue
    }

    if (from.port.kind === 'data') {
      const la = from.port.level_v
      const lb = to.port.level_v
      if (la != null && lb != null && la !== lb) {
        issues.push({
          level: 'warning',
          rule: 'protocol',
          message: `${nodeLabel(from.node, from.component)}.${from.port.id} → ${nodeLabel(to.node, to.component)}.${to.port.id}: níveis lógicos diferentes (${la} V e ${lb} V) — pode precisar de conversor.`,
          nodeIds: [from.node.id, to.node.id],
          edgeIds: [edge.id],
        })
      } else if (la == null || lb == null) {
        issues.push({
          level: 'unverifiable',
          rule: 'protocol',
          message: `${nodeLabel(from.node, from.component)}.${from.port.id} → ${nodeLabel(to.node, to.component)}.${to.port.id}: nível lógico não confirmado em uma das pontas.`,
          nodeIds: [from.node.id, to.node.id],
          edgeIds: [edge.id],
        })
      }
    }
  }

  return issues
}
