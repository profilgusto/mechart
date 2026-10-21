import type { Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { resolveEdge, portRef, effectiveCurrent } from '../model/graph'

const mA = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} A` : `${v} mA`)

/**
 * Soma o consumo de tudo que pende de cada saida de energia e compara com a
 * corrente que ela entrega. Consumo nao confirmado nao vira zero: a soma e
 * marcada como incompleta.
 */
export function checkBudget(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Issue[] {
  const issues: Issue[] = []

  type Load = { label: string; draw: number | null; peak: number | null; edgeId: string }
  const bySource = new Map<string, { label: string; supply: number | null; loads: Load[] }>()

  for (const edge of edges) {
    const r = resolveEdge(lib, nodes, edge)
    if (!r) continue
    // O cabo USB leva dados e 5 V: o host e a fonte, o device e a carga.
    const usb = r.from.port.vbus && r.to.port.vbus && r.from.port.vbus !== r.to.port.vbus
    const [from, to] =
      usb && r.from.port.vbus === 'device' ? [r.to, r.from] : [r.from, r.to]
    if (!usb) {
      if (from.port.kind !== 'power' || to.port.kind !== 'power') continue
      const fornece = from.port.dir === 'source' || from.port.dir === 'bidir'
      const consome = to.port.dir === 'sink' || to.port.dir === 'bidir'
      if (!fornece || !consome) continue
    }

    const k = `${from.node.id}\u0000${from.port.id}`
    if (!bySource.has(k)) {
      bySource.set(k, {
        label: `${portRef(from.node, from.component, from.port)}`,
        // Ramos em paralelo somam a corrente que a fonte entrega.
        supply: effectiveCurrent(from.node, from.port, 'supply'),
        loads: [],
      })
    }
    bySource.get(k)!.loads.push({
      label: `${portRef(to.node, to.component, to.port)}`,
      draw: effectiveCurrent(to.node, to.port, 'draw'),
      peak: effectiveCurrent(to.node, to.port, 'peak'),
      edgeId: edge.id,
    })
  }

  for (const [k, rail] of bySource) {
    const nodeId = k.split('\u0000')[0]
    const edgeIds = rail.loads.map((l) => l.edgeId)

    const known = rail.loads.filter((l) => l.draw !== null)
    const unknown = rail.loads.filter((l) => l.draw === null)
    const total = known.reduce((s, l) => s + (l.draw as number), 0)
    const peakTotal = rail.loads.reduce((s, l) => s + (l.peak ?? l.draw ?? 0), 0)

    if (rail.supply === null) {
      issues.push({
        level: 'unverifiable',
        rule: 'budget',
        message: `${rail.label}: a corrente máxima desta fonte não está confirmada — o consumo somado de ${mA(total)} não pode ser verificado.`,
        nodeIds: [nodeId],
        edgeIds,
      })
      continue
    }

    if (total > rail.supply) {
      issues.push({
        level: 'error',
        rule: 'budget',
        message: `${rail.label}: consumo somado de ${mA(total)} passa dos ${mA(rail.supply)} que a fonte entrega (${rail.loads.length} cargas).`,
        nodeIds: [nodeId],
        edgeIds,
      })
    } else if (peakTotal > rail.supply) {
      issues.push({
        level: 'warning',
        rule: 'budget',
        message: `${rail.label}: em regime médio cabe (${mA(total)} de ${mA(rail.supply)}), mas o pico exigido chega a ${mA(peakTotal)}.`,
        nodeIds: [nodeId],
        edgeIds,
      })
    } else if (total > rail.supply * 0.8) {
      issues.push({
        level: 'warning',
        rule: 'budget',
        message: `${rail.label}: ${mA(total)} de ${mA(rail.supply)} — acima de 80% da capacidade, sem margem.`,
        nodeIds: [nodeId],
        edgeIds,
      })
    }

    if (unknown.length > 0) {
      issues.push({
        level: 'unverifiable',
        rule: 'budget',
        message: `${rail.label}: soma incompleta — ${unknown.length} carga(s) sem consumo confirmado (${unknown.map((l) => l.label).join(', ')}). Verificado até aqui: ${mA(total)} de ${mA(rail.supply)}.`,
        nodeIds: [nodeId],
        edgeIds: unknown.map((l) => l.edgeId),
      })
    }
  }

  return issues
}
