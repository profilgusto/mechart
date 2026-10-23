import type { Issue, Library, Range } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { resolveEdge, portRef, effectiveVoltage } from '../model/graph'
import { rangeBounds, formatRange } from '../data/normalize'

const fmt = (r: Range | null | undefined) =>
  r ? formatRange(r, 'V') : 'a confirmar'

/**
 * Compara a faixa que a fonte entrega com a faixa que o consumidor aceita.
 * Sem interseccao = erro. Interseccao parcial = aviso (a fonte PODE sair da
 * faixa, tipico de uma fonte ajustavel). Faixa desconhecida nunca vira "ok".
 */
export function checkVoltage(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Issue[] {
  const issues: Issue[] = []

  for (const edge of edges) {
    const r = resolveEdge(lib, nodes, edge)
    if (!r) continue
    const { from, to } = r
    if (from.port.kind !== 'power' || to.port.kind !== 'power') continue

    const where = `${portRef(from.node, from.component, from.port)} → ${portRef(to.node, to.component, to.port)}`

    const srcV = effectiveVoltage(from.node, from.port)
    const dstV = effectiveVoltage(to.node, to.port)
    const src = srcV ? rangeBounds(srcV) : null
    const dst = dstV ? rangeBounds(dstV) : null

    if (!src || !dst) {
      const faltando = !src
        ? portRef(from.node, from.component, from.port)
        : portRef(to.node, to.component, to.port)
      issues.push({
        level: 'unverifiable',
        rule: 'voltage',
        message: `${where}: tensão não verificável — ${faltando} não tem faixa de tensão confirmada (${!src ? fmt(srcV) : fmt(dstV)}).`,
        nodeIds: [from.node.id, to.node.id],
        edgeIds: [edge.id],
      })
      continue
    }

    if (src.hi < dst.lo || src.lo > dst.hi) {
      issues.push({
        level: 'error',
        rule: 'voltage',
        message: `${where}: tensões incompatíveis — a fonte entrega ${fmt(srcV)} e a entrada aceita ${fmt(dstV)}.`,
        nodeIds: [from.node.id, to.node.id],
        edgeIds: [edge.id],
      })
      continue
    }

    // Saida PWM: o piso de 0 V e o duty em zero (carga parada); so o pico precisa caber.
    if (from.port.pwm) {
      if (src.hi > dst.hi) {
        issues.push({
          level: 'warning',
          rule: 'voltage',
          message: `${where}: o pico da saída PWM (${fmt(srcV)}) passa do que a entrada aceita (${fmt(dstV)}). Reduza VM ou o máximo declarado antes de ligar a carga.`,
          nodeIds: [from.node.id, to.node.id],
          edgeIds: [edge.id],
        })
      }
      continue
    }

    if (src.lo < dst.lo || src.hi > dst.hi) {
      issues.push({
        level: 'warning',
        rule: 'voltage',
        message: `${where}: a fonte pode sair da faixa — entrega ${fmt(srcV)}, a entrada aceita ${fmt(dstV)}. Ajuste e confira antes de ligar a carga.`,
        nodeIds: [from.node.id, to.node.id],
        edgeIds: [edge.id],
      })
    }
  }

  return issues
}
