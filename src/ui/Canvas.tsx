import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Edge,
  type NodeChange,
  MarkerType,
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Component, Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { handleId, nodeLabel, packTotals, effectiveVoltage, resolveEdge } from '../model/graph'
import { formatRangeCompact, rangeBounds } from '../data/normalize'
import { expandEdge, uartInstancesOf } from '../model/pins'
import ComponentNode, { type ComponentFlowNode } from './ComponentNode'
import { PROTOCOL_COLOR } from './legend'

const nodeTypes = { component: ComponentNode }

/** Largura do bloco em styles.css (.node), para centrar o cursor ao soltar. */
const NODE_W = 210

/** "3S2P · 6 células" para um pack; null quando o bloco e uma peca unica. */
function describePack(node: ArchNode, component: Component): string | null {
  const t = packTotals(node, component)
  if (!t || t.units === 1) return null
  return `${t.notation} · ${t.units} células`
}

/**
 * A tensão que chega em cada porta de energia de ENTRADA (sink), vinda da saída
 * do componente que a alimenta. É o espelho do selo de saída: mostra o que o
 * destino recebe, calculado a partir do que a fonte aplica. Só entram portas
 * puramente de entrada -- uma porta comum (BMS) recebe e entrega, e aí o valor
 * seria ambíguo.
 */
function incomingVoltages(
  library: Library,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Record<string, Record<string, { text: string; range: boolean; level: 'bad' | 'warn' | null }>> {
  const out: Record<string, Record<string, { text: string; range: boolean; level: 'bad' | 'warn' | null }>> = {}
  for (const e of edges) {
    const r = resolveEdge(library, nodes, e)
    if (!r) continue
    const { from, to } = r
    if (to.port.kind !== 'power' || to.port.dir !== 'sink') continue
    if (from.port.kind !== 'power' || from.port.dir === 'sink') continue

    const v = effectiveVoltage(from.node, from.port)
    if (!v || v.unknown) continue
    const src = rangeBounds(v)
    if (!src) continue

    // Mesma regra de validation/voltage.ts. So marca quando as duas faixas sao
    // conhecidas: sem interseçao = erro (vermelho); a fonte poder sair da faixa
    // que a entrada aceita = aviso (ambar). Desconhecida nunca vira alerta.
    const d = effectiveVoltage(to.node, to.port)
    const dst = d && !d.unknown ? rangeBounds(d) : null
    const disjoint = Boolean(dst && (src.hi < dst.lo || src.lo > dst.hi))
    const over = Boolean(dst && !disjoint && (src.lo < dst.lo || src.hi > dst.hi))
    const level: 'bad' | 'warn' | null = disjoint ? 'bad' : over ? 'warn' : null

    const byPort = (out[to.node.id] ??= {})
    if (byPort[to.port.id]) continue // a primeira fonte que alimenta manda
    byPort[to.port.id] = { text: formatRangeCompact(v, 'V'), range: src.lo !== src.hi, level }
  }
  return out
}

export default function Canvas({
  library,
  nodes,
  edges,
  issues,
  selectedNodeIds,
  connectFrom,
  expanded,
  onNodesChange,
  onSelectionChange,
  onDrop,
  onDeleteEdges,
  onStartConnect,
  onCancelConnect,
  onStartDisconnect,
  onPickTarget,
  centerRef,
}: {
  library: Library
  nodes: ArchNode[]
  edges: ArchEdge[]
  issues: Issue[]
  /** Blocos selecionados (Shift acrescenta, arrastar move todos). */
  selectedNodeIds: string[]
  /** Bloco de origem quando ha uma ligacao em curso. */
  connectFrom: string | null
  /** Modo expandido: cada ligacao abre nos condutores que ela representa. */
  expanded: boolean
  onNodesChange: (next: ArchNode[]) => void
  onSelectionChange: (nodeIds: string[]) => void
  onDrop: (componentId: string, position: { x: number; y: number }) => void
  /** O App registra aqui como pedir a posicao no centro da viewport. */
  centerRef: { current: (() => { x: number; y: number }) | null }
  onDeleteEdges: (ids: string[]) => void
  onStartConnect: (nodeId: string) => void
  onCancelConnect: () => void
  onStartDisconnect: (nodeId: string) => void
  onPickTarget: (targetId: string) => void
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  
  // Estado interno do ReactFlow para posições durante drag
  const [internalNodes, setInternalNodes] = useState<ComponentFlowNode[]>([])

  /**
   * O botao "+" da biblioteca nao sabe onde o usuario esta olhando: sem isso o
   * bloco nasce fora da tela. Registra como converter o centro da viewport para
   * coordenadas do fluxo (a diferenca de escala e pan do React Flow).
   */
  useEffect(() => {
    centerRef.current = () => {
      const rect = wrapper.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      const p = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
      return { x: p.x - NODE_W / 2, y: p.y - 40 }
    }
    return () => {
      centerRef.current = null
    }
  }, [screenToFlowPosition, centerRef])

  // Pior nivel de problema por no e por aresta, para colorir o canvas.
  const worst = useMemo(() => {
    const rank = { error: 3, warning: 2, unverifiable: 1 }
    const nodeLevel: Record<string, Issue['level']> = {}
    const edgeLevel: Record<string, Issue['level']> = {}
    for (const i of issues) {
      for (const id of i.nodeIds ?? []) {
        if (!nodeLevel[id] || rank[i.level] > rank[nodeLevel[id]]) nodeLevel[id] = i.level
      }
      for (const id of i.edgeIds ?? []) {
        if (!edgeLevel[id] || rank[i.level] > rank[edgeLevel[id]]) edgeLevel[id] = i.level
      }
    }
    return { nodeLevel, edgeLevel }
  }, [issues])

  useMemo(() => {
    const ids = new Set(selectedNodeIds)
    const multi = selectedNodeIds.length > 1
    const incoming = incomingVoltages(library, nodes, edges)
    const newNodes = nodes.flatMap((n) => {
      const component = library.byId[n.componentId]
      if (!component) return []
      const uartInstances: Record<string, ReturnType<typeof uartInstancesOf>> = {}
      if (expanded) {
        for (const p of component.ports) {
          if (p.protocol !== 'uart') continue
          const inst = uartInstancesOf(library, nodes, edges, n, p)
          if (inst) uartInstances[p.id] = inst
        }
      }
      return [
        {
          id: n.id,
          type: 'component' as const,
          position: n.position,
          selected: ids.has(n.id),
          data: {
            component,
            label: nodeLabel(n, component),
            level: worst.nodeLevel[n.id] ?? null,
            arrangement: describePack(n, component),
            connected: edges.flatMap((e) =>
              e.source === n.id ? [e.sourcePort] : e.target === n.id ? [e.targetPort] : [],
            ),
            incoming: incoming[n.id] ?? {},
            uartInstances,
            expanded,
            node: n,
            connecting: connectFrom !== null,
            isOrigin: connectFrom === n.id,
            multiSelected: multi,
            onStartConnect,
            onCancelConnect,
            onStartDisconnect,
          },
        },
      ]
    })
    setInternalNodes(newNodes)
    return newNodes
  }, [nodes, edges, library, selectedNodeIds, worst, connectFrom, expanded, onStartConnect, onCancelConnect, onStartDisconnect])

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.flatMap((e) => {
        const srcComp = library.byId[nodes.find((n) => n.id === e.source)?.componentId ?? '']
        const port = srcComp?.ports.find((p) => p.id === e.sourcePort)
        const isPower = port?.kind === 'power'
        const level = worst.edgeLevel[e.id]
        const color =
          level === 'error'
            ? '#d14343'
            : level === 'warning'
              ? '#c98a12'
              : isPower
                ? '#7a7a7a'
                : (PROTOCOL_COLOR[port?.protocol ?? ''] ?? '#7a7a7a')

        const base = {
          source: e.source,
          target: e.target,
          animated: level === 'error',
          labelStyle: { fontSize: 10, fill: color },
          labelBgStyle: { fill: 'var(--panel)', fillOpacity: 0.9 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
        }

        if (expanded) {
          const { links } = expandEdge(library, nodes, e)
          if (links.length > 0) {
            const tgtComp = library.byId[nodes.find((n) => n.id === e.target)?.componentId ?? '']
            const targetPort = tgtComp?.ports.find((p) => p.id === e.targetPort)
            const srcNode = nodes.find((n) => n.id === e.source)
            const tgtNode = nodes.find((n) => n.id === e.target)
            // So preenche quando esta porta tem 2+ ligacoes simultaneas -- e so
            // aí que o card abre uma linha por instância (ver ComponentNode).
            const srcMulti =
              srcNode && port ? uartInstancesOf(library, nodes, edges, srcNode, port) : null
            const tgtMulti =
              tgtNode && targetPort ? uartInstancesOf(library, nodes, edges, tgtNode, targetPort) : null

            // Uma linha por condutor, cada uma chegando no seu pino. tx sempre
            // manda e rx sempre recebe: expandEdge as vezes pareia com os papeis
            // trocados (a origem da aresta fica com o pino rx), entao a seta
            // desta sub-linha segue o pino tx, nao necessariamente e.source.
            return links.map((l) => {
              const reversed = l.sourcePin.signal === 'rx' && l.targetPin.signal === 'tx'
              const fromNode = reversed ? e.target : e.source
              const toNode = reversed ? e.source : e.target
              const fromPort = reversed ? e.targetPort : e.sourcePort
              const toPort = reversed ? e.sourcePort : e.targetPort
              const fromPin = reversed ? l.targetPin : l.sourcePin
              const toPin = reversed ? l.sourcePin : l.targetPin
              const fromMulti = reversed ? tgtMulti : srcMulti
              const toMulti = reversed ? srcMulti : tgtMulti

              return {
                ...base,
                id: l.id,
                source: fromNode,
                target: toNode,
                sourceHandle: handleId('out', fromPort, fromMulti ? `${e.id}|${fromPin.id}` : fromPin.id),
                targetHandle: handleId('in', toPort, toMulti ? `${e.id}|${toPin.id}` : toPin.id),
                // Sem rotulo: as duas pontas ja nomeiam o pino e o sinal, e com
                // varios condutores paralelos os rotulos so se atropelam.
                style: { stroke: color, strokeWidth: 1.4, strokeDasharray: isPower ? undefined : '6 4' },
              }
            })
          }
          // Sem pinagem publicada, a ligacao continua sendo uma linha so.
        }

        return [
          {
            ...base,
            id: e.id,
            sourceHandle: handleId('out', e.sourcePort),
            targetHandle: handleId('in', e.targetPort),
            label: isPower ? undefined : port?.protocol,
            style: {
              stroke: color,
              strokeWidth: isPower ? 2.5 : 1.6,
              strokeDasharray: isPower ? undefined : '6 4',
            },
          },
        ]
      }),
    [edges, nodes, library, worst, expanded],
  )

  /**
   * So propaga o que muda o documento: posicao e remocao. Reemitir o estado a
   * cada evento de 'dimensions' ou 'select' recria os nos, o React Flow remede,
   * e o ciclo nunca fecha -- o canvas fica vazio e o autosave nunca termina.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<ComponentFlowNode>[]) => {
      // Aplica mudanças no estado interno do ReactFlow (para drag visual suave)
      setInternalNodes((nodes) => applyNodeChanges(changes, nodes))
      
      const moved = new Map<string, { x: number; y: number }>()
      const removed = new Set<string>()

      for (const c of changes) {
        // Só persiste posições finais (quando solta o mouse)
        if (c.type === 'position' && c.position && !c.dragging) {
          moved.set(c.id, c.position)
        } else if (c.type === 'remove') {
          removed.add(c.id)
        }
      }
      if (moved.size === 0 && removed.size === 0) return

      onNodesChange(
        nodes
          .filter((n) => !removed.has(n.id))
          .map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)),
      )

      if (removed.size > 0) {
        onDeleteEdges(
          edges.filter((e) => removed.has(e.source) || removed.has(e.target)).map((e) => e.id),
        )
      }
    },
    [nodes, edges, onNodesChange, onDeleteEdges],
  )

  return (
    <div className="canvas" ref={wrapper}>
      <ReactFlow
        className={connectFrom ? 'is-connecting' : undefined}
        nodes={internalNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesDelete={(deleted) => onDeleteEdges(deleted.map((e) => e.id))}
        // Shift acrescenta blocos a selecao; com varios marcados, arrastar move todos.
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
        onSelectionChange={({ nodes: sel }) => onSelectionChange(sel.map((n) => n.id))}
        onNodeClick={(_, n) => {
          if (connectFrom && connectFrom !== n.id) onPickTarget(n.id)
        }}
        onPaneClick={() => {
          if (connectFrom) onCancelConnect()
        }}
        // Ligar e por clique, nao por arrasto entre conectores.
        nodesConnectable={false}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const componentId = e.dataTransfer.getData('application/karu-component')
          if (!componentId) return
          // clientX/Y sao coordenadas de tela; o fluxo tem pan e zoom proprios.
          const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
          onDrop(componentId, { x: p.x - NODE_W / 2, y: p.y - 40 })
        }}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="karu-minimap" />
      </ReactFlow>
    </div>
  )
}
