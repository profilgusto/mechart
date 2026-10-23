import type { Component, Library, Port, Range } from './types'
import type { ArchEdge, ArchNode, Resolved } from './graph'
import { arrangement, effectiveCurrent, effectiveVoltage, resolveEdge, rolesOf } from './graph'
import { getTypeHierarchy } from './component-type'

/**
 * Visão de potência: quem fornece energia ao sistema (ativo), quem só a recebe
 * (passivo) e quem a transforma ou encaminha gastando um pouco no caminho (serviço).
 */
export type PowerRole = 'active' | 'passive' | 'service'

export const POWER_ROLE_LABEL: Record<PowerRole, string> = {
  active: 'ativo',
  passive: 'passivo',
  service: 'serviço',
}

export const POWER_ROLE_COLOR: Record<PowerRole, string> = {
  active: '#e0a127',
  passive: '#3b6fd4',
  service: '#7b8794',
}

/** Conversores de verdade: a corrente de entrada sai da POTENCIA de saida / eficiencia. */
const CONVERTERS = new Set(['dc-dc-converter', 'battery-charger'])

/** Sem declaracao no catalogo, o papel sai das portas de energia. */
export function powerRoleOf(component: Component): PowerRole {
  const isCell = getTypeHierarchy(component.type)[0] === 'battery-cell'
  if (component.external || component.instance.pack || isCell) return 'active'
  const supplies = component.ports.some(
    (p) => p.kind === 'power' && (p.dir === 'source' || p.dir === 'bidir'),
  )
  return supplies ? 'service' : 'passive'
}

/** Corrente em mA. `partial`: ha carga a jusante sem consumo confirmado, entao o valor e so um piso. */
export type Level = { mA: number; mW: number | null; partial: boolean }

/** Cenarios de consumo: o minimo (repouso), o nominal (tipico) e o pico. */
export type Scenario = 'min' | 'nom' | 'peak'

/** O valor nominal, mais o que a mesma conta da no minimo e no pico. */
export type Flow = Level & { min?: Level; peak?: Level }

export type EdgePower = Flow & {
  /** Ramo que nao carrega a carga neste regime (o carregador ao lado da bateria). */
  idle: boolean
  /** A origem esta sem energia (fonte desligada, ou nada a alimenta): nao passa corrente. */
  dead: boolean
}

export type PortPower = { in?: Flow; out?: Flow }

export type NodePower = {
  role: PowerRole
  /** Chega energia a este bloco (ou, sendo fonte ativa, esta ligada). */
  energized: boolean
  ports: Record<string, PortPower>
  totalIn: Flow | null
  /** `limit`: soma da corrente maxima das saidas em uso, quando todas a declaram. */
  totalOut: (Flow & { limit: number | null; peakLimit?: number; peakNote?: string }) | null
}

export type PowerResult = {
  /** So as arestas que carregam energia; as demais ficam fora desta visao. */
  edges: Record<string, EdgePower>
  /** Origem e destino corretos do fluxo (o cabo USB pode estar guardado ao contrario). */
  direction: Record<string, { from: Resolved; to: Resolved }>
  nodes: Record<string, NodePower>
}

const key = (nodeId: string, portId: string) => `${nodeId}\u0000${portId}`

/** Tensao para o calculo: nominal; sem ela, o meio da faixa. */
function nominal(r: Range | null): number | null {
  if (!r || r.unknown) return null
  if (r.nom != null) return r.nom
  if (r.min != null && r.max != null) return (r.min + r.max) / 2
  return r.max ?? r.min ?? null
}

function efficiency(component: Component): number {
  const e = component.raw.efficiency
  const pct =
    typeof e === 'number'
      ? e
      : e && typeof e === 'object' && typeof (e as { typical?: unknown }).typical === 'number'
        ? (e as { typical: number }).typical
        : null
  return pct != null && pct > 0 && pct <= 100 ? pct / 100 : 1
}

type PEdge = { id: string; from: Resolved; to: Resolved; volt: number | null }

/** As ligacoes que carregam energia, ja orientadas de quem fornece para quem consome. */
function powerEdges(lib: Library, nodes: ArchNode[], edges: ArchEdge[]): PEdge[] {
  const out: PEdge[] = []
  for (const edge of edges) {
    const r = resolveEdge(lib, nodes, edge)
    if (!r) continue
    // O cabo USB leva dados e 5 V: o host e a fonte, o device e a carga.
    const usb = r.from.port.vbus && r.to.port.vbus && r.from.port.vbus !== r.to.port.vbus
    let { from, to } = r
    if (usb) {
      if (from.port.vbus === 'device') [from, to] = [to, from]
    } else {
      if (from.port.kind !== 'power' || to.port.kind !== 'power') continue
      const fornece = from.port.dir === 'source' || from.port.dir === 'bidir'
      const consome = to.port.dir === 'sink' || to.port.dir === 'bidir'
      if (!fornece || !consome) continue
    }
    // Se a orientacao normalizada nao tem os conectores certos, mantem a original.
    if (!rolesOf(from.port).includes('out') || !rolesOf(to.port).includes('in')) {
      ;({ from, to } = r)
    }
    const volt = usb
      ? 5
      : (nominal(effectiveVoltage(from.node, from.port)) ?? nominal(effectiveVoltage(to.node, to.port)))
    out.push({ id: edge.id, from, to, volt })
  }
  return out
}

/** Consumo de uma porta de entrada em cada cenario; sem o dado do cenario, cai no nominal. */
function drawFor(node: ArchNode, port: Port, sc: Scenario): number | null {
  const nom = effectiveCurrent(node, port, 'draw')
  if (sc === 'nom') return nom
  if (sc === 'peak') return effectiveCurrent(node, port, 'peak') ?? nom
  if (port.draw_min_mA == null) return nom
  return Number((port.draw_min_mA * arrangement(node).parallel).toFixed(4))
}

/** As tres contas: o mesmo grafo resolvido no minimo, no nominal e no pico. */
export function computePower(lib: Library, nodes: ArchNode[], edges: ArchEdge[]): PowerResult {
  const pedges = powerEdges(lib, nodes, edges)
  const nom = solve(lib, nodes, pedges, 'nom')
  const lo = solve(lib, nodes, pedges, 'min')
  const hi = solve(lib, nodes, pedges, 'peak')

  const level = (f: Flow): Level => ({ mA: f.mA, mW: f.mW, partial: f.partial })
  const attach = (f: Flow | null | undefined, a: Flow | null | undefined, b: Flow | null | undefined) => {
    if (!f || !a || !b) return
    f.min = level(a)
    f.peak = level(b)
  }
  for (const id of Object.keys(nom.edges)) attach(nom.edges[id], lo.edges[id], hi.edges[id])
  for (const id of Object.keys(nom.nodes)) {
    const n = nom.nodes[id]
    attach(n.totalIn, lo.nodes[id]?.totalIn, hi.nodes[id]?.totalIn)
    attach(n.totalOut, lo.nodes[id]?.totalOut, hi.nodes[id]?.totalOut)
    for (const pid of Object.keys(n.ports)) {
      attach(n.ports[pid].in, lo.nodes[id]?.ports[pid]?.in, hi.nodes[id]?.ports[pid]?.in)
      attach(n.ports[pid].out, lo.nodes[id]?.ports[pid]?.out, hi.nodes[id]?.ports[pid]?.out)
    }
  }
  return nom
}

function solve(lib: Library, nodes: ArchNode[], pedges: PEdge[], sc: Scenario): PowerResult {

  const inBy = new Map<string, PEdge[]>() // por no
  const outBy = new Map<string, PEdge[]>() // por porta de saida
  for (const e of pedges) {
    ;(inBy.get(e.to.node.id) ?? inBy.set(e.to.node.id, []).get(e.to.node.id)!).push(e)
    const k = key(e.from.node.id, e.from.port.id)
    ;(outBy.get(k) ?? outBy.set(k, []).get(k)!).push(e)
  }

  const isCharger = (c: Component) => getTypeHierarchy(c.type)[0] === 'battery-charger'
  /** O carregador alimenta a bateria, nao a carga: sai do caminho quando ha outra fonte. */
  const idle = (e: PEdge) =>
    isCharger(e.from.component) &&
    (inBy.get(e.to.node.id) ?? []).some(
      (o) => o !== e && !isCharger(o.from.component) && !dead(o),
    )

  /** Uma fonte ativa ligada energiza o que esta ligado a ela, de ponta a ponta. */
  const energyMemo = new Map<string, boolean>()
  const energized = (node: ArchNode, component: Component): boolean => {
    const hit = energyMemo.get(node.id)
    if (hit !== undefined) return hit
    energyMemo.set(node.id, false) // guarda contra laco
    const ok =
      powerRoleOf(component) === 'active'
        ? !node.off
        : (inBy.get(node.id) ?? []).some((e) => energized(e.from.node, e.from.component))
    energyMemo.set(node.id, ok)
    return ok
  }
  const dead = (e: PEdge) => !energized(e.from.node, e.from.component)

  const live = (list: PEdge[]) => list.filter((e) => !idle(e) && !dead(e))

  const edgeMemo = new Map<string, { mA: number; partial: boolean }>()
  const nodeMemo = new Map<string, Map<string, { mA: number; partial: boolean }>>()
  const visiting = new Set<string>()

  /** Quanto cada porta de entrada do no puxa dos seus alimentadores. */
  function inputDemand(node: ArchNode, component: Component) {
    const hit = nodeMemo.get(node.id)
    if (hit) return hit
    const demand = new Map<string, { mA: number; partial: boolean }>()
    nodeMemo.set(node.id, demand)
    if (visiting.has(node.id)) return demand // laco: corta aqui
    visiting.add(node.id)

    const role = powerRoleOf(component)
    const ins = live(inBy.get(node.id) ?? [])
    const inPorts = [...new Set(ins.map((e) => e.to.port.id))].map(
      (id) => component.ports.find((p) => p.id === id)!,
    )

    if (role === 'active') {
      // Fonte e bateria: a entrada (carga do pack) nao entra no regime de uso.
    } else if (role === 'passive') {
      for (const p of inPorts) {
        const draw = drawFor(node, p, sc)
        demand.set(p.id, { mA: draw ?? 0, partial: draw == null })
      }
    } else {
      const converter = CONVERTERS.has(getTypeHierarchy(component.type)[0])
      // Em modulos que so encaminham, uma porta com consumo proprio declarado
      // (o VCC logico do driver) e carga a parte; as demais repassam a saida.
      const own = (p: (typeof inPorts)[number]) =>
        !converter && drawFor(node, p, sc) != null
      for (const p of inPorts.filter(own)) {
        demand.set(p.id, { mA: drawFor(node, p, sc)!, partial: false })
      }
      const main = inPorts.filter((p) => !own(p))

      // O que a saida pede, somado nas ligacoes que saem do no.
      let outMA = 0
      let outMW = 0
      let partial = false
      for (const p of component.ports) {
        if (p.kind !== 'power' || !(p.dir === 'source' || p.dir === 'bidir')) continue
        for (const e of live(outBy.get(key(node.id, p.id)) ?? [])) {
          const c = edgeCurrent(e)
          outMA += c.mA
          partial ||= c.partial
          if (e.volt != null) outMW += c.mA * e.volt
          else partial = true
        }
      }

      let need = outMA
      if (converter) {
        const vin = nominal(main.length ? mainVoltage(ins, main[0].id) : null)
        if (vin) need = outMW / (efficiency(component) * vin)
        else if (outMW > 0) partial = true
        // Corrente de repouso do DC-DC (a "draw" da entrada). No carregador a
        // "draw" e a corrente maxima de entrada, nao um consumo em vazio.
        if (getTypeHierarchy(component.type)[0] === 'dc-dc-converter') {
          for (const p of main) need += effectiveCurrent(node, p, 'draw') ?? 0
        }
      }
      for (const p of main) {
        demand.set(p.id, { mA: need / main.length, partial })
      }
    }

    visiting.delete(node.id)
    return demand
  }

  /** Faixa de tensao que o primeiro alimentador entrega a esta porta. */
  function mainVoltage(ins: PEdge[], portId: string): Range | null {
    const e = ins.find((x) => x.to.port.id === portId)
    return e && e.volt != null ? { nom: e.volt, unknown: false } : null
  }

  function edgeCurrent(e: PEdge): { mA: number; partial: boolean } {
    const hit = edgeMemo.get(e.id)
    if (hit) return hit
    edgeMemo.set(e.id, { mA: 0, partial: true }) // guarda contra laco
    let result = { mA: 0, partial: false }
    if (!idle(e) && !dead(e)) {
      const d = inputDemand(e.to.node, e.to.component).get(e.to.port.id)
      const feeders = live(inBy.get(e.to.node.id) ?? []).filter(
        (x) => x.to.port.id === e.to.port.id,
      )
      if (d && feeders.length > 0) result = { mA: d.mA / feeders.length, partial: d.partial }
    }
    edgeMemo.set(e.id, result)
    return result
  }

  const result: PowerResult = { edges: {}, direction: {}, nodes: {} }

  for (const e of pedges) {
    const c = edgeCurrent(e)
    result.edges[e.id] = {
      mA: c.mA,
      mW: e.volt != null ? c.mA * e.volt : null,
      partial: c.partial,
      idle: idle(e),
      dead: dead(e),
    }
    result.direction[e.id] = { from: e.from, to: e.to }
  }

  const add = (a: Flow | undefined, b: EdgePower): Flow => ({
    mA: (a?.mA ?? 0) + b.mA,
    mW: a?.mW === null || b.mW === null ? null : (a?.mW ?? 0) + b.mW,
    partial: Boolean(a?.partial) || b.partial,
  })

  for (const n of nodes) {
    const component = lib.byId[n.componentId]
    if (!component) continue
    result.nodes[n.id] = {
      role: powerRoleOf(component),
      energized: energized(n, component),
      ports: {},
      totalIn: null,
      totalOut: null,
    }
  }

  const limits = new Map<string, { limit: number | null; peakLimit: number; peakNote?: string; ports: Set<string> }>()
  for (const e of pedges) {
    const flow = result.edges[e.id]
    const src = result.nodes[e.from.node.id]
    const dst = result.nodes[e.to.node.id]
    if (src) {
      const pp = (src.ports[e.from.port.id] ??= {})
      pp.out = add(pp.out, flow)
      src.totalOut = { ...add(src.totalOut ?? undefined, flow), limit: null }
      const l = limits.get(e.from.node.id) ?? { limit: 0, peakLimit: 0, ports: new Set<string>() }
      if (!l.ports.has(e.from.port.id)) {
        l.ports.add(e.from.port.id)
        const s = effectiveCurrent(e.from.node, e.from.port, 'supply')
        l.limit = l.limit === null || s === null ? null : l.limit + s
        const sp = effectiveCurrent(e.from.node, e.from.port, 'supplyPeak')
        if (sp != null) {
          l.peakLimit += sp
          l.peakNote ??= e.from.port.supply_peak_note
        }
      }
      limits.set(e.from.node.id, l)
    }
    if (dst) {
      const pp = (dst.ports[e.to.port.id] ??= {})
      pp.in = add(pp.in, flow)
      dst.totalIn = add(dst.totalIn ?? undefined, flow)
    }
  }
  for (const [id, l] of limits) {
    const t = result.nodes[id]?.totalOut
    if (t) {
      t.limit = l.limit
      if (l.peakLimit > 0) {
        t.peakLimit = l.peakLimit
        t.peakNote = l.peakNote
      }
    }
  }

  return result
}

/** "850 mA", "1,25 A"; piso (`partial`) vira "≥ …", e sem nada somado "?". */
export function formatCurrent(mA: number, partial = false): string {
  if (partial && mA <= 0) return '?'
  const v =
    mA >= 1000
      ? `${trim(mA / 1000, 2)} A`
      : `${trim(mA, mA < 10 ? 1 : 0)} mA`
  return partial ? `≥ ${v}` : v
}

export function formatPower(mW: number | null, partial = false): string | null {
  if (mW === null || (partial && mW <= 0)) return null
  const v = mW >= 1000 ? `${trim(mW / 1000, 2)} W` : `${trim(mW, mW < 10 ? 1 : 0)} mW`
  return partial ? `≥ ${v}` : v
}

const trim = (v: number, digits: number) =>
  Number(v.toFixed(digits)).toLocaleString('pt-BR', { maximumFractionDigits: digits })

/**
 * "240 / 440 / 2 A" (min / nominal / pico) quando os tres cenarios diferem;
 * um valor so quando coincidem. A unidade e a do maior, para ler a escala de relance.
 */
export function formatTriple(f: Flow): string {
  const lv = [f.min ?? f, f, f.peak ?? f]
  const same = lv.every((l) => l.mA === f.mA && l.partial === f.partial)
  if (same) return formatCurrent(f.mA, f.partial)
  const big = Math.max(...lv.map((l) => l.mA)) >= 1000
  const all = lv.every((l) => l.partial)
  const one = (l: Level) => {
    if (l.partial && l.mA <= 0) return '?'
    const v = big ? trim(l.mA / 1000, 2) : trim(l.mA, l.mA < 10 ? 1 : 0)
    return l.partial && !all ? `≥ ${v}` : v
  }
  return `${all ? '≥ ' : ''}${lv.map(one).join(' / ')} ${big ? 'A' : 'mA'}`
}
