import type { Component, Library, Port, Range } from './types'

export type ArchNode = {
  id: string
  componentId: string
  position: { x: number; y: number }
  /** Rotulo livre, ex. "motor traseiro esquerdo". */
  label?: string
  /**
   * Unidades em serie que este bloco representa. A ficha (specs) descreve UMA
   * celula; um pack 3S2P e series: 3, parallel: 2.
   * Serie multiplica a TENSAO.
   */
  series?: number
  /**
   * Ramos em paralelo. Paralelo NAO mexe na tensao: multiplica a capacidade e a
   * corrente que o pack aguenta entregar ou aceitar.
   */
  parallel?: number
  /**
   * Tensao em que uma fonte ajustavel foi de fato regulada (o trimmer do
   * MP1584EN). Sem isso, a saida de 0,8-20 V alerta contra qualquer carga.
   */
  setVoltage?: number
  /**
   * Corrente maxima que uma fonte externa entrega, declarada na montagem. A
   * fonte de bancada nao tem datasheet no catalogo: o numero e do adapter que o
   * usuario vai ligar, entao fica na instancia e nao no arquivo do componente.
   */
  setCurrent?: number
}

export type ArchEdge = {
  id: string
  source: string
  sourcePort: string
  target: string
  targetPort: string
}

export type ArchGraph = {
  nodes: ArchNode[]
  edges: ArchEdge[]
}

/**
 * Uma porta bidirecional precisa de dois handles no React Flow (um de cada
 * tipo), entao o id do handle carrega o papel: "out:uart" / "in:uart".
 */
export function handleId(role: 'out' | 'in', portId: string, pinId?: string): string {
  return pinId ? `${role}:${portId}|${pinId}` : `${role}:${portId}`
}

export function portIdOf(handle: string | null | undefined): string {
  if (!handle) return ''
  const i = handle.indexOf(':')
  const resto = i === -1 ? handle : handle.slice(i + 1)
  const j = resto.indexOf('|')
  return j === -1 ? resto : resto.slice(0, j)
}

/** Papel da porta, o eixo que interessa na hora de ligar: quem recebe, quem entrega. */
export type PortRole = 'in' | 'out' | 'bidir'

export function roleOf(port: Port): PortRole {
  switch (port.dir) {
    case 'sink':
    case 'in':
      return 'in'
    case 'source':
    case 'out':
      return 'out'
    case 'bidir':
      return 'bidir'
  }
}

export const ROLE_LABEL: Record<PortRole, string> = {
  in: 'entrada',
  out: 'saída',
  bidir: 'bidirecional',
}

/** Handles que uma porta expoe: fonte, destino, ou os dois. */
export function rolesOf(port: Port): ('out' | 'in')[] {
  switch (port.dir) {
    case 'source':
    case 'out':
      return ['out']
    case 'sink':
    case 'in':
      return ['in']
    case 'bidir':
      return ['out', 'in']
  }
}

export type Resolved = {
  node: ArchNode
  component: Component
  port: Port
}

/** Localiza componente e porta das duas pontas de uma aresta. */
export function resolveEdge(
  lib: Library,
  nodes: ArchNode[],
  edge: ArchEdge,
): { from: Resolved; to: Resolved } | null {
  const find = (nodeId: string, portId: string): Resolved | null => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return null
    const component = lib.byId[node.componentId]
    if (!component) return null
    const port = component.ports.find((p) => p.id === portId)
    if (!port) return null
    return { node, component, port }
  }

  const from = find(edge.source, edge.sourcePort)
  const to = find(edge.target, edge.targetPort)
  return from && to ? { from, to } : null
}

/**
 * A faixa de tensao que a porta realmente ve nesta instancia, depois de aplicar
 * os ajustes do no: celulas em serie e a tensao regulada de uma fonte ajustavel.
 */
export function effectiveVoltage(node: ArchNode, port: Port): Range | null {
  if (port.kind !== 'power') return null

  if (port.dir === 'source' && node.setVoltage != null) {
    return { nom: node.setVoltage, unknown: false }
  }

  const { series } = arrangement(node)
  if (series === 1 || !port.v) return port.v ?? null

  // Arredonda: 3 x 4.2 daria 12.600000000000001 e dispararia um alerta falso.
  const scale = (v: number) => Number((v * series).toFixed(4))

  return {
    min: port.v.min != null ? scale(port.v.min) : undefined,
    nom: port.v.nom != null ? scale(port.v.nom) : undefined,
    max: port.v.max != null ? scale(port.v.max) : undefined,
    unknown: false,
    note: port.v.note,
  }
}

/** Quantas unidades em serie/paralelo, sempre ao menos 1. */
export function arrangement(node: ArchNode): { series: number; parallel: number } {
  return {
    series: Math.max(1, Math.round(node.series ?? 1)),
    parallel: Math.max(1, Math.round(node.parallel ?? 1)),
  }
}

/**
 * Corrente que esta instancia entrega (porta source) ou consome (porta sink).
 * Ramos em paralelo somam; a serie nao muda corrente. Valor nao confirmado
 * continua nulo: multiplicar desconhecido por 2 continua desconhecido.
 */
export function effectiveCurrent(
  node: ArchNode,
  port: Port,
  which: 'supply' | 'draw' | 'peak',
): number | null {
  // Fonte externa: a corrente e do adapter ligado, declarada na instancia.
  if (which === 'supply' && node.setCurrent != null) return node.setCurrent

  const raw =
    which === 'supply' ? port.supply_mA : which === 'peak' ? port.peak_mA : port.draw_mA
  if (raw == null) return null
  return Number((raw * arrangement(node).parallel).toFixed(4))
}

/**
 * Grupos de portas obrigatorias ainda nao satisfeitas. Portas mutuamente
 * exclusivas formam um grupo alternativo -- a entrada USB-C e os pinos 5 V do
 * header de um SBC, por exemplo: basta UMA do grupo estar ligada. O grupo
 * inteiro e devolvido para que a UI marque todas e a mensagem diga "A ou B".
 * Um grupo de um elemento e a porta obrigatoria de sempre.
 */
export function missingRequired(component: Component, connected: Set<string>): Port[][] {
  const grupos: Port[][] = []
  const visitadas = new Set<string>()

  for (const port of component.ports) {
    if (!port.required || visitadas.has(port.id)) continue

    // Fecha o grupo seguindo a exclusividade mutua, em qualquer sentido.
    const ids = new Set<string>([port.id])
    let mudou = true
    while (mudou) {
      mudou = false
      for (const p of component.ports) {
        if (ids.has(p.id)) continue
        const ligado = [...ids].some((g) => {
          const gp = component.ports.find((x) => x.id === g)
          return Boolean(gp?.exclusiveWith?.includes(p.id) || p.exclusiveWith?.includes(g))
        })
        if (ligado) {
          ids.add(p.id)
          mudou = true
        }
      }
    }
    ids.forEach((id) => visitadas.add(id))

    if ([...ids].some((id) => connected.has(id))) continue
    grupos.push([...ids].map((id) => component.ports.find((p) => p.id === id)!).filter(Boolean))
  }

  return grupos
}

/** Totais do pack, quando o componente e uma unidade arranjavel. */
export type PackTotals = {
  series: number
  parallel: number
  units: number
  /** "3S2P" */
  notation: string
  voltage: Range | null
  capacity_mAh: number | null
  energy_Wh: number | null
  weight_g: number | null
}

export function packTotals(node: ArchNode, component: Component): PackTotals | null {
  if (!component.instance.pack) return null

  const { series, parallel } = arrangement(node)
  const unit = component.instance.unit ?? {}

  const source = component.ports.find((p) => p.kind === 'power' && p.dir === 'source')
  const voltage = source ? effectiveVoltage(node, source) : null

  const capacity_mAh =
    unit.capacity_mAh != null ? Number((unit.capacity_mAh * parallel).toFixed(2)) : null

  // Energia so sai se a tensao nominal do pack for conhecida.
  const vNom = voltage && !voltage.unknown ? voltage.nom : undefined
  const energy_Wh =
    capacity_mAh != null && vNom != null
      ? Number(((capacity_mAh / 1000) * vNom).toFixed(2))
      : null

  return {
    series,
    parallel,
    units: series * parallel,
    notation: `${series}S${parallel}P`,
    voltage,
    capacity_mAh,
    energy_Wh,
    weight_g: unit.weight_g != null ? Number((unit.weight_g * series * parallel).toFixed(2)) : null,
  }
}

export function nodeLabel(node: ArchNode, component: Component): string {
  return node.label || component.id
}

/** A, B, ... Z, AA, AB, ... */
function letters(i: number): string {
  let s = ''
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}

function freeName(componentId: string, taken: Set<string>): string {
  for (let i = 0; ; i++) {
    const name = `${componentId}-${letters(i)}`
    if (!taken.has(name)) return name
  }
}

/**
 * Nome de um bloco novo. O primeiro de um tipo leva o id puro; ao entrar o
 * segundo, o original vira "-A" e o novo "-B", e assim por diante. Nomes que o
 * usuário escolheu nunca são trocados. `renames` = blocos já existentes que
 * mudam de nome (o original sem sufixo).
 */
export function nextNaming(
  nodes: ArchNode[],
  componentId: string,
): { label?: string; renames: Record<string, string> } {
  const same = nodes.filter((n) => n.componentId === componentId)
  if (same.length === 0) return { renames: {} }
  const taken = new Set(same.map((n) => n.label || componentId))
  const renames: Record<string, string> = {}
  for (const n of same) {
    if (n.label) continue
    const name = freeName(componentId, taken)
    taken.add(name)
    renames[n.id] = name
  }
  return { label: freeName(componentId, taken), renames }
}

/**
 * Projetos antigos: blocos repetidos sem rótulo, ou com o "id (2)" do esquema
 * anterior, ganham o sufixo em letra. Rótulos do usuário ficam como estão.
 */
export function normalizeNames(nodes: ArchNode[]): ArchNode[] {
  const byComponent = new Map<string, ArchNode[]>()
  for (const n of nodes) byComponent.set(n.componentId, [...(byComponent.get(n.componentId) ?? []), n])
  const out = new Map<string, string>()
  for (const [id, group] of byComponent) {
    if (group.length < 2) continue
    const legacy = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+\\)$`)
    const auto = group.filter((n) => !n.label || legacy.test(n.label))
    const taken = new Set(group.filter((n) => !auto.includes(n)).map((n) => n.label!))
    for (const n of auto) {
      const name = freeName(id, taken)
      taken.add(name)
      out.set(n.id, name)
    }
  }
  return out.size === 0 ? nodes : nodes.map((n) => (out.has(n.id) ? { ...n, label: out.get(n.id) } : n))
}

/** Nome da porta como o card a mostra (ex.: "BO1 / BO2"), nunca o id interno. */
export function portName(port: Port): string {
  return port.label ?? port.id
}

/** "componente (BO1 / BO2)": o par que o usuário localiza no card. */
export function portRef(node: ArchNode, component: Component, port: Port): string {
  return `${nodeLabel(node, component)} (${portName(port)})`
}
