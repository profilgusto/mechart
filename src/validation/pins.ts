import type { Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { resolveEdge, nodeLabel } from '../model/graph'
import { expandEdge } from '../model/pins'

/**
 * Condutores de energia que ficaram sem par. O caso que importa e o pack menor
 * do que o BMS espera: um 1S ligado a uma placa 3S deixa B1 e B2 sem alimentar,
 * e sem eles nao ha balanceamento nenhum.
 *
 * Pinos de dados soltos NAO entram: uma porta unidirecional deixa o TX do host
 * sobrando o tempo todo, e isso e normal.
 */
export function checkPins(lib: Library, nodes: ArchNode[], edges: ArchEdge[]): Issue[] {
  const issues: Issue[] = []

  for (const edge of edges) {
    const r = resolveEdge(lib, nodes, edge)
    if (!r) continue

    const { from, to } = r
    if (from.port.kind !== 'power') continue

    const exp = expandEdge(lib, nodes, edge)
    // Sem pinagem publicada nao ha o que conferir: ja aparece como linha unica.
    if (exp.reason) continue

    const onde = `${nodeLabel(from.node, from.component)}.${from.port.id} → ${nodeLabel(to.node, to.component)}.${to.port.id}`

    if (exp.links.length === 0) {
      issues.push({
        level: 'warning',
        rule: 'pins',
        message: `${onde}: nenhum condutor casou — os dois lados têm pinagem declarada, mas nenhum sinal em comum.`,
        nodeIds: [from.node.id, to.node.id],
        edgeIds: [edge.id],
      })
      continue
    }

    if (exp.soltos.length > 0) {
      const lista = exp.soltos.map((s) => `${s.lado}.${s.pin.id}`).join(', ')
      const n = exp.soltos.length
      issues.push({
        level: 'warning',
        rule: 'pins',
        message: `${onde}: ${n === 1 ? 'um condutor ficou' : `${n} condutores ficaram`} sem par — ${lista}. Confira se os dois lados têm o mesmo número de células.`,
        nodeIds: [from.node.id, to.node.id],
        edgeIds: [edge.id],
      })
    }
  }

  return issues
}
