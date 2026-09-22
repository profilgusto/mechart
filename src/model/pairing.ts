import type { Component, Library, Port, PortKind } from './types'
import type { ArchEdge, ArchNode } from './graph'
import { nodeLabel, effectiveVoltage, effectiveCurrent } from './graph'
import { portsCompatible } from '../validation/protocol'
import { formatRange, rangeBounds } from '../data/normalize'

/** Uma forma concreta de ligar dois blocos: um par de portas, com sentido. */
export type Candidate = {
  id: string
  source: string
  sourcePort: string
  target: string
  targetPort: string
  kind: PortKind
  protocol?: string
  /** "UART" ou "Energia" -- o titulo da opcao no modal. */
  title: string
  /** "sensor-lidar.uart-tx → orange-pi.uart" */
  path: string
  /** Numeros uteis para escolher, ex. "5 V · entrega 3000 mA". */
  detail?: string
  note?: string
}

export type Pairing =
  | { ok: true; candidates: Candidate[] }
  | { ok: false; reason: string }

const key = (n: string, p: string) => `${n}\u0000${p}`

/** Quantas ligacoes cada porta ja tem. */
function usage(edges: ArchEdge[]): Map<string, number> {
  const m = new Map<string, number>()
  const bump = (n: string, p: string) => m.set(key(n, p), (m.get(key(n, p)) ?? 0) + 1)
  for (const e of edges) {
    bump(e.source, e.sourcePort)
    bump(e.target, e.targetPort)
  }
  return m
}

/** A porta ainda aceita mais uma ligacao, e nao conflita com uma exclusiva em uso. */
function livre(node: ArchNode, port: Port, used: Map<string, number>): boolean {
  if ((used.get(key(node.id, port.id)) ?? 0) >= port.count) return false
  return !port.exclusiveWith?.some((outra) => (used.get(key(node.id, outra)) ?? 0) > 0)
}

function describe(
  node: ArchNode,
  component: Component,
  port: Port,
  papel: 'fonte' | 'destino',
): string | undefined {
  if (port.kind === 'power') {
    const v = effectiveVoltage(node, port)
    const partes = [v ? formatRange(v, 'V') : 'tensão a confirmar']
    if (papel === 'fonte') {
      const s = effectiveCurrent(node, port, 'supply')
      partes.push(s != null ? `entrega ${s} mA` : 'capacidade a confirmar')
    } else {
      const d = effectiveCurrent(node, port, 'draw')
      if (d != null) partes.push(`consome ${d} mA`)
    }
    return partes.join(' · ')
  }
  void component
  return port.level_v != null ? `${port.level_v} V` : 'nível a confirmar'
}

/**
 * Todas as formas de ligar dois blocos. Considera os dois sentidos, porque o
 * usuario clica "ligue estes dois" e nao deveria ter de adivinhar quem e a
 * fonte; pares equivalentes nos dois sentidos aparecem uma vez so.
 */
export function possibleConnections(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
  aId: string,
  bId: string,
): Pairing {
  const a = nodes.find((n) => n.id === aId)
  const b = nodes.find((n) => n.id === bId)
  if (!a || !b || a.id === b.id) return { ok: false, reason: 'seleção inválida' }

  const ca = lib.byId[a.componentId]
  const cb = lib.byId[b.componentId]
  if (!ca || !cb) return { ok: false, reason: 'componente desconhecido' }

  if (ca.ports.length === 0 || cb.ports.length === 0) {
    const semPortas = ca.ports.length === 0 ? ca.id : cb.id
    return {
      ok: false,
      reason: `${semPortas} ainda não tem portas declaradas em arquitetura/ports.json.`,
    }
  }

  const used = usage(edges)
  const jaLigado = (ns: string, ps: string, nt: string, pt: string) =>
    edges.some(
      (e) =>
        (e.source === ns && e.sourcePort === ps && e.target === nt && e.targetPort === pt) ||
        (e.source === nt && e.sourcePort === pt && e.target === ns && e.targetPort === ps),
    )

  let compativeis = 0
  let jaExistentes = 0
  let tensaoIncompativel = 0
  const vistos = new Set<string>()
  const candidates: Candidate[] = []

  const sentidos: [ArchNode, Component, ArchNode, Component][] = [
    [a, ca, b, cb],
    [b, cb, a, ca],
  ]

  for (const [ns, cs, nt, ct] of sentidos) {
    for (const ps of cs.ports) {
      for (const pt of ct.ports) {
        if (!portsCompatible(ps, pt).ok) continue
        compativeis++

        // Uma porta que so faz sentido num ponto da topologia (o lado B+/B- de
        // um BMS) nao entra como opcao fora dele: o app sabe que esta errado.
        if (ps.only && !ps.only.includes(ct.id)) continue
        if (pt.only && !pt.only.includes(cs.id)) continue

        // Duas faixas de tensao que nao se cruzam nunca sao o que o usuario
        // quer -- e o que faria a saida da ponte H virar candidata a alimentar
        // o 3V3 do ESP32.
        if (ps.kind === 'power') {
          const bs = effectiveVoltage(ns, ps)
          const bt = effectiveVoltage(nt, pt)
          const rs = bs ? rangeBounds(bs) : null
          const rt = bt ? rangeBounds(bt) : null
          if (rs && rt && (rs.hi < rt.lo || rs.lo > rt.hi)) {
            tensaoIncompativel++
            continue
          }
        }

        // Um par bidirecional serve nos dois sentidos: e a mesma ligacao.
        const par = [`${ns.id}:${ps.id}`, `${nt.id}:${pt.id}`].sort().join('|')
        if (vistos.has(par)) continue
        vistos.add(par)

        if (jaLigado(ns.id, ps.id, nt.id, pt.id)) {
          jaExistentes++
          continue
        }
        if (!livre(ns, ps, used) || !livre(nt, pt, used)) continue

        const detalhes = [
          describe(ns, cs, ps, 'fonte'),
          describe(nt, ct, pt, 'destino'),
        ].filter(Boolean)

        candidates.push({
          id: `${ns.id}:${ps.id}->${nt.id}:${pt.id}`,
          source: ns.id,
          sourcePort: ps.id,
          target: nt.id,
          targetPort: pt.id,
          kind: ps.kind,
          protocol: ps.protocol,
          title: ps.kind === 'power' ? 'Energia' : (ps.protocol ?? 'dados').toUpperCase(),
          path: `${nodeLabel(ns, cs)}.${ps.id} → ${nodeLabel(nt, ct)}.${pt.id}`,
          detail: detalhes.join('  ·  '),
          note: ps.note ?? pt.note,
        })
      }
    }
  }

  if (candidates.length > 0) {
    // Energia primeiro; depois por protocolo, para a lista ficar previsivel.
    candidates.sort((x, y) => {
      if (x.kind !== y.kind) return x.kind === 'power' ? -1 : 1
      return x.title.localeCompare(y.title) || x.path.localeCompare(y.path)
    })
    return { ok: true, candidates }
  }

  if (compativeis === 0) {
    return {
      ok: false,
      reason: `${ca.id} e ${cb.id} não têm nenhum par de portas compatível — nem energia, nem um protocolo em comum.`,
    }
  }
  if (jaExistentes > 0) {
    return {
      ok: false,
      reason: `${ca.id} e ${cb.id} já estão ligados por todas as portas compatíveis.`,
    }
  }
  if (tensaoIncompativel > 0) {
    return {
      ok: false,
      reason: `${ca.id} e ${cb.id} só têm portas de energia, e as faixas de tensão não se cruzam — nenhuma ligação direta é segura.`,
    }
  }
  return {
    ok: false,
    reason: `As portas compatíveis entre ${ca.id} e ${cb.id} já estão no limite de ligações (ou bloqueadas por uma porta mutuamente exclusiva já em uso).`,
  }
}
