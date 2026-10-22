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

export type PortInstance = {
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
 * O "pino" de uma porta sem pinagem declarada: um condutor so, que leva o nome
 * da propria porta. Da a essas ligacoes uma bolinha propria no modo condutores.
 */
export const portPin = (port: Port): Pin => ({ id: port.label ?? port.id, signal: '' })

/** Barramentos: todos os dispositivos dividem os mesmos fios, em paralelo. */
const BARRAMENTOS = new Set(['i2c', 'spi', 'can'])

/**
 * A porta e um ponto fisico UNICO que varias ligacoes dividem: o OUT+/OUT- de
 * um DC-DC alimenta todas as cargas pelos mesmos dois terminais, e o SDA/SCL
 * de um barramento vai em paralelo a todos os dispositivos.
 */
export const portaCompartilhada = (port: Port) =>
  port.kind === 'power' || BARRAMENTOS.has(port.protocol ?? '')

/**
 * O "pino" que uma porta SEM pinagem tem para receber um condutor do outro lado.
 * Dois fios (A e B de um encoder) ocupam dois GPIO fisicos, entao cada um ganha o
 * seu; com um fio so, a porta tem um condutor unico.
 */
export function pinParaFio(port: Port, fio: Pin, fios: Pin[]): Pin {
  if (fios.length < 2) return portPin(port)
  // tx/rx definem o sentido da linha: o pino sintetico nao pode copiar isso.
  return { id: `${port.label ?? port.id} (${fio.id})`, signal: fio.signal === 'tx' || fio.signal === 'rx' ? '' : fio.signal }
}

/**
 * Quando o MESMO componente liga mais de uma vez numa porta ponto a ponto (PWM,
 * GPIO, UART, USB), cada ligacao e um fio fisico diferente, e o card precisa
 * mostrar cada uma separada: uma bolinha por ligacao. Portas compartilhadas
 * (energia, I²C/SPI/CAN) e as de 0 ou 1 ligacao continuam com uma bolinha so.
 */
export function portInstancesOf(
  lib: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
  node: ArchNode,
  port: Port,
): PortInstance[] | null {
  if (portaCompartilhada(port)) return null

  const attached = edges.filter(
    (e) =>
      (e.source === node.id && e.sourcePort === port.id) ||
      (e.target === node.id && e.targetPort === port.id),
  )

  const component = lib.byId[node.componentId]
  const declared = component ? pinsOf(node, component, port) : null

  // Os fios que o outro lado desta ligacao traz (so importam se esta porta nao
  // tem pinagem propria: sao eles que pedem uma bolinha cada).
  const fiosDe = (edge: ArchEdge): Pin[] | null => {
    if (declared) return null
    const isSource = edge.source === node.id
    const other = nodes.find((n) => n.id === (isSource ? edge.target : edge.source))
    const otherComp = other ? lib.byId[other.componentId] : undefined
    const otherPort = otherComp?.ports.find(
      (p) => p.id === (isSource ? edge.targetPort : edge.sourcePort),
    )
    return other && otherComp && otherPort ? pinsOf(other, otherComp, otherPort) : null
  }
  const algumMultifio = attached.some((e) => (fiosDe(e)?.length ?? 0) >= 2)
  if (attached.length < 2 && !algumMultifio) return null

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
    const locais: Pin[] = []
    for (const link of exp.links) {
      const localPin = isSource ? link.sourcePin : link.targetPin
      if (!locais.some((p) => p.id === localPin.id)) locais.push(localPin)
    }
    // Sem par de pinos (o outro lado nao declara pinagem): todos os pinos locais.
    // Sem pinagem nenhuma: o condutor unico da porta.
    const fios = fiosDe(edge)
    const usados =
      locais.length > 0
        ? locais
        : (declared ?? (fios ? fios.map((f) => pinParaFio(port, f, fios)) : [portPin(port)]))

    const pins = usados.map((pin) => ({
      pin,
      role: (pin.signal === 'tx' ? 'out' : pin.signal === 'rx' ? 'in' : isSource ? 'out' : 'in') as
        | 'in'
        | 'out',
    }))

    return {
      edgeId: edge.id,
      label: port.instances?.[i] ?? `ligação ${i + 1}`,
      otherLabel,
      pins,
    }
  })
}
