import type { Component, Library, Pin, Port } from './types'
import type { ArchEdge, ArchNode } from './graph'
import { arrangement, resolveEdge, nodeLabel } from './graph'

/** Sinais que se ligam cruzados; todo o resto casa com o proprio nome. */
const CRUZADOS: Record<string, string> = { tx: 'rx', rx: 'tx' }

const parDe = (signal: string) => CRUZADOS[signal] ?? signal

/**
 * Os pinos que esta INSTANCIA expoe. Um pack em serie nao tem os mesmos
 * condutores de uma celula solta: 3S acrescenta dois taps de balanceamento.
 */
export function pinsOf(node: ArchNode, component: Component, port: Port): Pin[] | null {
  if (!port.pins) return null

  const { series } = arrangement(node)
  if (!component.instance.pack || series === 1 || port.kind !== 'power') return port.pins

  const pos = port.pins.find((p) => p.signal === 'pos')
  const neg = port.pins.find((p) => p.signal === 'neg')
  if (!pos || !neg) return port.pins

  // N celulas em serie expoem N-1 junções intermediarias para o balanceamento.
  const taps: Pin[] = Array.from({ length: series - 1 }, (_, i) => ({
    id: `B${i + 1}`,
    signal: `tap${i + 1}`,
    note: `junção entre a célula ${i + 1} e a ${i + 2}`,
  }))

  return [neg, ...taps, pos]
}

export type PinLink = {
  id: string
  sourcePin: Pin
  targetPin: Pin
}

export type Expansion = {
  links: PinLink[]
  /** Pinos que ficaram sem par -- vale avisar, nao esconder. */
  soltos: { lado: string; pin: Pin }[]
  /** Por que nao deu para expandir, quando nao deu. */
  reason?: string
}

/** Quebra uma ligacao porta-a-porta nos condutores que ela representa. */
export function expandEdge(
  lib: Library,
  nodes: ArchNode[],
  edge: ArchEdge,
): Expansion {
  const r = resolveEdge(lib, nodes, edge)
  if (!r) return { links: [], soltos: [], reason: 'ligação não resolvida' }

  const { from, to } = r
  const ps = pinsOf(from.node, from.component, from.port)
  const pt = pinsOf(to.node, to.component, to.port)

  if (!ps || !pt) {
    const quem = !ps
      ? `${nodeLabel(from.node, from.component)}.${from.port.id}`
      : `${nodeLabel(to.node, to.component)}.${to.port.id}`
    return {
      links: [],
      soltos: [],
      reason: `pinagem de ${quem} não está declarada no arquivo do componente`,
    }
  }

  const links: PinLink[] = []
  const usadosDestino = new Set<string>()

  for (const a of ps) {
    const alvo = pt.find((b) => !usadosDestino.has(b.id) && b.signal === parDe(a.signal))
    if (!alvo) continue
    usadosDestino.add(alvo.id)
    links.push({
      id: `${edge.id}::${a.id}->${alvo.id}`,
      sourcePin: a,
      targetPin: alvo,
    })
  }

  const ligadosOrigem = new Set(links.map((l) => l.sourcePin.id))
  const soltos = [
    ...ps.filter((p) => !ligadosOrigem.has(p.id)).map((pin) => ({
      lado: nodeLabel(from.node, from.component),
      pin,
    })),
    ...pt.filter((p) => !usadosDestino.has(p.id)).map((pin) => ({
      lado: nodeLabel(to.node, to.component),
      pin,
    })),
  ]

  return { links, soltos }
}

export type UartInstance = {
  /** Id da aresta que esta instância representa -- namespace dos handles. */
  edgeId: string
  /** "UART0", "ligação 2"... o que identifica este pino físico no card. */
  label: string
  /** Rótulo do componente do outro lado, para o subtítulo da instância. */
  otherLabel: string
  /** Pinos locais desta ligação, já com o papel correto (a partir do signal). */
  pins: { pin: Pin; role: 'in' | 'out' }[]
}

/**
 * Quando o MESMO componente liga mais de uma vez numa porta UART (cada
 * ligação simultânea é um pino físico diferente, ao contrário de um
 * barramento), o card precisa mostrar cada uma separada, com Tx/Rx corretos.
 * Só se aplica a portas ponto-a-ponto (`protocol: "uart"`) com 2+ ligações;
 * um barramento (I²C/SPI) continua mostrando uma linha só, porque ali as
 * ligações de fato dividem os mesmos fios.
 */
export function uartInstancesOf(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
  node: ArchNode,
  port: Port,
): UartInstance[] | null {
  if (port.protocol !== 'uart') return null

  const attached = edges.filter(
    (e) =>
      (e.source === node.id && e.sourcePort === port.id) ||
      (e.target === node.id && e.targetPort === port.id),
  )
  if (attached.length < 2) return null

  return attached.map((edge, i) => {
    const isSource = edge.source === node.id
    const otherNodeId = isSource ? edge.target : edge.source
    const otherNode = nodes.find((n) => n.id === otherNodeId)
    const otherComponent = otherNode ? lib.byId[otherNode.componentId] : undefined
    const otherLabel =
      otherNode && otherComponent ? nodeLabel(otherNode, otherComponent) : otherNodeId

    // A direção de cada pino vem do próprio signal (tx = envia, rx = recebe),
    // não de quem é "source"/"target" da aresta -- expandEdge pareia tx com rx
    // cruzado, e o lado que fica com o "sourcePin" pode ser o que recebe.
    const exp = expandEdge(lib, nodes, edge)
    const pins: { pin: Pin; role: 'in' | 'out' }[] = []
    for (const link of exp.links) {
      const localPin = isSource ? link.sourcePin : link.targetPin
      if (pins.some((p) => p.pin.id === localPin.id)) continue
      const role: 'in' | 'out' =
        localPin.signal === 'tx' ? 'out' : localPin.signal === 'rx' ? 'in' : isSource ? 'out' : 'in'
      pins.push({ pin: localPin, role })
    }

    return {
      edgeId: edge.id,
      label: port.instances?.[i] ?? `ligação ${i + 1}`,
      otherLabel,
      pins,
    }
  })
}
