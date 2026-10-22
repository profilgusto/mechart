import type { Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { nodeLabel, resolveEdge } from '../model/graph'

/** Um chip do dispositivo: um endereco fixo, ou varios a escolher por um pino. */
type Slot = { who: string; nodeId: string; edgeId: string; options: string[] }

const hex = (a: string) => `0x${parseInt(a, 16).toString(16).toUpperCase().padStart(2, '0')}`

/** Escolhe um endereco livre para cada slot de endereco selecionavel; null se nao couber. */
function assign(slots: Slot[], taken: Set<string>): string[] | null {
  if (slots.length === 0) return []
  const [first, ...rest] = slots
  for (const a of first.options) {
    if (taken.has(a)) continue
    const next = assign(rest, new Set(taken).add(a))
    if (next) return [a, ...next]
  }
  return null
}

/**
 * Dois dispositivos no mesmo barramento I²C nao podem responder pelo mesmo
 * endereco. O barramento e a porta do lado que NAO declara `addresses` (o
 * controlador, ex. o ESP32); cada ligacao nela traz um dispositivo, e o que o
 * dispositivo ocupa vem do `addresses` da sua porta -- um endereco fixo, ou uma
 * lista de alternativas escolhida por pino (SA0 do BNO086).
 *
 * Outros protocolos nao entram: SPI separa dispositivos por chip-select, UART
 * e ponto a ponto, e CAN identifica mensagens, nao dispositivos.
 */
export function checkAddresses(lib: Library, nodes: ArchNode[], edges: ArchEdge[]): Issue[] {
  const issues: Issue[] = []

  type Device = { slots: Slot[]; node: ArchNode; edgeId: string; semEndereco: boolean; who: string }
  const buses = new Map<string, { host: ArchNode; label: string; count: number; devices: Device[] }>()

  for (const edge of edges) {
    const r = resolveEdge(lib, nodes, edge)
    if (!r || r.from.port.protocol !== 'i2c') continue

    const ladoA = r.from
    const ladoB = r.to
    const aTem = Boolean(ladoA.port.addresses?.length)
    const bTem = Boolean(ladoB.port.addresses?.length)
    // Dispositivo com endereco de um lado so; sem endereco dos dois, o
    // controlador e quem o app nao sabe distinguir -- tratado abaixo.
    const dispositivo = aTem && !bTem ? ladoA : bTem && !aTem ? ladoB : null
    const host = dispositivo === ladoA ? ladoB : dispositivo === ladoB ? ladoA : null
    if (!host) continue

    const key = `${host.node.id}\u0000${host.port.id}`
    if (!buses.has(key)) {
      buses.set(key, {
        host: host.node,
        label: `${nodeLabel(host.node, host.component)}.${host.port.label ?? host.port.id}`,
        count: host.port.count,
        devices: [],
      })
    }
    const who = nodeLabel(dispositivo!.node, dispositivo!.component)
    buses.get(key)!.devices.push({
      node: dispositivo!.node,
      edgeId: edge.id,
      who,
      semEndereco: false,
      slots: (dispositivo!.port.addresses ?? []).map((a) => ({
        who,
        nodeId: dispositivo!.node.id,
        edgeId: edge.id,
        options: (Array.isArray(a) ? a : [a]).map(hex),
      })),
    })
  }

  for (const bus of buses.values()) {
    if (bus.devices.length < 2) continue

    // count pequeno = numero de barramentos fisicos da porta (o Orange Pi tem 3):
    // nao da para saber em qual deles cada dispositivo esta. count grande e o
    // limite de enderecos de um barramento unico (ESP32).
    const varios = bus.count > 1 && bus.count <= 16
    const level = varios ? 'unverifiable' : 'error'
    const sufixo = varios
      ? ` — a porta tem ${bus.count} barramentos físicos; confira em qual cada dispositivo está.`
      : '.'

    const slots = bus.devices.flatMap((d) => d.slots)
    const ids = (ss: Slot[]) => ({
      nodeIds: [...new Set([bus.host.id, ...ss.map((s) => s.nodeId)])],
      edgeIds: [...new Set(ss.map((s) => s.edgeId))],
    })

    // Enderecos fixos: dois no mesmo valor e colisao certa.
    const fixos = slots.filter((s) => s.options.length === 1)
    const porEndereco = new Map<string, Slot[]>()
    for (const s of fixos) porEndereco.set(s.options[0], [...(porEndereco.get(s.options[0]) ?? []), s])
    const ocupados = new Set(porEndereco.keys())

    for (const [addr, ss] of porEndereco) {
      if (ss.length < 2) continue
      issues.push({
        level,
        rule: 'address',
        message: `${bus.label}: ${[...new Set(ss.map((s) => s.who))].join(' e ')} respondem pelo mesmo endereço I²C ${addr}${sufixo}`,
        ...ids(ss),
      })
    }

    // Enderecos selecionaveis: cada grupo de dispositivos que disputam as mesmas
    // opcoes precisa de uma escolha sem colisao (o aht20 nao entra na briga dos bno086).
    const escolhiveis = slots.filter((s) => s.options.length > 1)
    const grupos: Slot[][] = []
    for (const s of escolhiveis) {
      const casam = grupos.filter((g) => g.some((o) => o.options.some((a) => s.options.includes(a))))
      const unido = [s, ...casam.flat()]
      for (const g of casam) grupos.splice(grupos.indexOf(g), 1)
      grupos.push(unido)
    }
    for (const g of grupos) {
      if (assign(g, ocupados)) continue
      const quem = [...new Set(g.map((s) => `${s.who} (${s.options.join('/')})`))].join(', ')
      issues.push({
        level,
        rule: 'address',
        message: `${bus.label}: não há endereço I²C livre para ${quem} — as opções disponíveis colidem entre si ou com outros dispositivos do barramento${sufixo}`,
        ...ids(g),
      })
    }
  }

  return issues
}
