import type { Component, Issue, Library, PhysPin, Port } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { nodeLabel } from '../model/graph'
import { expandEdge, pinsOf } from '../model/pins'

/** Um pino fisico que o projeto pede ao componente, e quem o pede. */
type Demand = {
  need: string
  who: string
  nodeId: string
  edgeId?: string
}

/**
 * Quantos fios desta ligacao chegam a esta porta, um pino fisico cada. Com
 * pinagem propria conta os condutores casados (TX+RX de uma UART); sem ela,
 * conta os fios do outro lado (A e B de um encoder pedem dois GPIO).
 */
function wiresOf(
  lib: Library,
  nodes: ArchNode[],
  node: ArchNode,
  component: Component,
  port: Port,
  edge: ArchEdge,
): number {
  const isSource = edge.source === node.id
  const declared = pinsOf(node, component, port)
  if (declared) {
    const casados = new Set(
      expandEdge(lib, nodes, edge).links.map((l) => (isSource ? l.sourcePin.id : l.targetPin.id)),
    )
    return casados.size > 0 ? casados.size : declared.length
  }
  const other = nodes.find((n) => n.id === (isSource ? edge.target : edge.source))
  const otherComp = other ? lib.byId[other.componentId] : undefined
  const otherPort = otherComp?.ports.find(
    (p) => p.id === (isSource ? edge.targetPort : edge.sourcePort),
  )
  const remotos = other && otherComp && otherPort ? pinsOf(other, otherComp, otherPort) : null
  return Math.max(1, remotos?.length ?? 1)
}

/** Emparelhamento maximo demanda -> pino (Kuhn); `pinOf[d]` e o indice do pino, ou -1. */
function match(
  demands: Demand[],
  pins: PhysPin[],
  eligible: (d: Demand, p: PhysPin) => boolean,
  pinOf: number[],
  ownerOf: number[],
) {
  const tenta = (d: number, visto: Set<number>): boolean => {
    for (let p = 0; p < pins.length; p++) {
      if (visto.has(p) || !eligible(demands[d], pins[p])) continue
      visto.add(p)
      if (ownerOf[p] === -1 || tenta(ownerOf[p], visto)) {
        ownerOf[p] = d
        pinOf[d] = p
        return true
      }
    }
    return false
  }
  for (let d = 0; d < demands.length; d++) if (pinOf[d] === -1) tenta(d, new Set())
}

/**
 * Confere se os pinos fisicos do componente (`pinout`) bastam para tudo que o
 * projeto liga nele. Cada porta com `uses` gasta pinos: um por fio ligado, ou
 * (barramentos) um conjunto fixo que todos os dispositivos dividem. Vale para
 * qualquer placa que declare a pinagem -- nada aqui e especifico de um modelo.
 *
 * Os pinos livres de ressalva vem primeiro; so quando acabam entram os com
 * `level: "caution"` (strapping, USB, UART de log), e isso vira aviso. Pinos
 * `reserved` (PSRAM, flash) nunca entram. O app nao atribui um pino a cada
 * ligacao: confere se uma atribuicao valida EXISTE, o que ja pega falta de
 * pinos e de capacidades (ADC) sem prender o usuario a um pinout.
 */
export function checkPinout(lib: Library, nodes: ArchNode[], edges: ArchEdge[]): Issue[] {
  const issues: Issue[] = []

  for (const node of nodes) {
    const component = lib.byId[node.componentId]
    if (!component?.pinout) continue
    const label = nodeLabel(node, component)

    const demands: Demand[] = []
    for (const port of component.ports) {
      if (!port.uses) continue
      const attached = edges.filter(
        (e) =>
          (e.source === node.id && e.sourcePort === port.id) ||
          (e.target === node.id && e.targetPort === port.id),
      )
      if (attached.length === 0) continue

      const nome = port.label ?? port.id
      const push = (n: number, who: string, edgeId?: string) => {
        for (let i = 0; i < n; i++) demands.push({ need: port.uses!.needs, who, nodeId: node.id, edgeId })
      }

      if (port.uses.shared != null) {
        push(port.uses.shared, `${nome} (barramento)`, attached[0].id)
        if (port.uses.perConnection) {
          for (const e of attached) {
            const otherId = e.source === node.id ? e.target : e.source
            const other = nodes.find((n) => n.id === otherId)
            const otherComp = other ? lib.byId[other.componentId] : undefined
            push(
              port.uses.perConnection,
              `${nome}: seleção de ${other && otherComp ? nodeLabel(other, otherComp) : otherId}`,
              e.id,
            )
          }
        }
        continue
      }

      for (const e of attached) {
        const otherId = e.source === node.id ? e.target : e.source
        const other = nodes.find((n) => n.id === otherId)
        const otherComp = other ? lib.byId[other.componentId] : undefined
        const quem = other && otherComp ? nodeLabel(other, otherComp) : otherId
        push(wiresOf(lib, nodes, node, component, port, e), `${nome} → ${quem}`, e.id)
      }
    }
    if (demands.length === 0) continue

    const todos = component.pinout.pins
    const usaveis = todos.filter((p) => p.level !== 'reserved')
    const livres = usaveis.filter((p) => !p.level)
    const tem = (d: Demand, p: PhysPin) => p.caps.includes(d.need)

    // Primeiro so os pinos sem ressalva; o que sobrar tenta os de ressalva.
    const pinOf = demands.map(() => -1)
    const ownerOf = usaveis.map(() => -1)
    match(demands, usaveis, (d, p) => !p.level && tem(d, p), pinOf, ownerOf)
    match(demands, usaveis, tem, pinOf, ownerOf)

    const semPino = demands.filter((_, i) => pinOf[i] === -1)
    const edgeIds = [...new Set(demands.map((d) => d.edgeId).filter((x): x is string => !!x))]
    const resumo = (ds: Demand[]) => {
      const por = new Map<string, number>()
      for (const d of ds) por.set(d.who, (por.get(d.who) ?? 0) + 1)
      return [...por].map(([who, n]) => (n > 1 ? `${who} ×${n}` : who)).join('; ')
    }

    if (semPino.length > 0) {
      const needs = [...new Set(semPino.map((d) => d.need))]
      const partes = needs.map((need) => {
        const pedem = demands.filter((d) => d.need === need).length
        const existem = usaveis.filter((p) => p.caps.includes(need)).length
        return need === 'gpio'
          ? `${pedem} pinos GPIO pedidos, ${existem} utilizáveis`
          : `${pedem} pinos com ${need.toUpperCase()} pedidos, só ${existem} têm`
      })
      issues.push({
        level: 'error',
        rule: 'pinout',
        message: `${label}: faltam pinos — ${partes.join('; ')} (${todos.length - usaveis.length} reservados pelo módulo). Pedidos: ${resumo(demands)}.`,
        nodeIds: [node.id],
        edgeIds,
      })
      continue
    }

    const ressalvas = new Set(pinOf.filter((p) => p >= 0 && usaveis[p].level === 'caution'))
    if (ressalvas.size > 0) {
      const porque = [
        ...new Set(
          usaveis.filter((p) => p.level === 'caution').map((p) => p.why ?? 'pino com restrição'),
        ),
      ]
      issues.push({
        level: 'warning',
        rule: 'pinout',
        message: `${label}: o projeto usa ${demands.length} pinos e só ${livres.length} são livres de ressalvas — ${ressalvas.size === 1 ? '1 ficará' : `${ressalvas.size} ficarão`} em pino com restrição (${porque.join('; ')}). Evite esses pinos se puder liberar outros.`,
        nodeIds: [node.id],
        edgeIds,
      })
    }
  }

  return issues
}
