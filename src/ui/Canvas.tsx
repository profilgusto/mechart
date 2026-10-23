import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
  Panel,
  useReactFlow,
  type Edge,
  type NodeChange,
  MarkerType,
  PanOnScrollMode,
  SelectionMode,
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Component, Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { handleId, nodeLabel, packTotals, effectiveVoltage, resolveEdge } from '../model/graph'
import { computePower, formatCurrent } from '../model/power'
import { formatRangeCompact, rangeBounds } from '../data/normalize'
import { expandEdge, pinsOf, pinParaFio, portInstancesOf, portPin } from '../model/pins'
import ComponentNode, { type ComponentFlowNode } from './ComponentNode'
import { PROTOCOL_COLOR } from './legend'

const nodeTypes = { component: ComponentNode }

/** Largura do bloco em styles.css (.node), para centrar o cursor ao soltar. */
const NODE_W = 210

/** Acompanha a animacao dos paineis (0.22s em styles.css). */
const PANEL_SHIFT = 'margin 0.22s cubic-bezier(0.4, 0, 0.2, 1)'

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
    // Saida PWM: o piso de 0 V e o duty em zero; so o pico precisa caber.
    const over = Boolean(
      dst && !disjoint && ((!from.port.pwm && src.lo < dst.lo) || src.hi > dst.hi),
    )
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
  issueFocus,
  onClearIssueFocus,
  selectedNodeIds,
  connectFrom,
  expanded,
  powerView,
  idAsTitle,
  onNodesChange,
  onSelectionChange,
  onDrop,
  onDeleteEdges,
  onStartConnect,
  onCancelConnect,
  onStartDisconnect,
  onRename,
  onPickTarget,
  onNodeOpen,
  centerRef,
  insets,
}: {
  library: Library
  nodes: ArchNode[]
  edges: ArchEdge[]
  issues: Issue[]
  /** Aviso clicado no painel: realca so o que ele envolve e enquadra na tela. */
  issueFocus: { nodeIds: string[]; edgeIds: string[] } | null
  onClearIssueFocus: () => void
  /** Blocos selecionados (Shift acrescenta, arrastar move todos). */
  selectedNodeIds: string[]
  /** Bloco de origem quando ha uma ligacao em curso. */
  connectFrom: string | null
  /** Modo expandido: cada ligacao abre nos condutores que ela representa. */
  expanded: boolean
  /** Visao de potencia: cards por papel, linhas unicas com a corrente de cada uma. */
  powerView: boolean
  /** Card mostra o id do componente como titulo, em vez do tipo level-0. */
  idAsTitle: boolean
  onNodesChange: (next: ArchNode[]) => void
  onSelectionChange: (nodeIds: string[]) => void
  onDrop: (componentId: string, position: { x: number; y: number }) => void
  /** O App registra aqui como pedir a posicao no centro da viewport. */
  centerRef: { current: (() => { x: number; y: number }) | null }
  onDeleteEdges: (ids: string[]) => void
  onStartConnect: (nodeId: string) => void
  onCancelConnect: () => void
  onStartDisconnect: (nodeId: string) => void
  onRename: (nodeId: string, label: string) => void
  onPickTarget: (targetId: string) => void
  /** Duplo clique num bloco (o App abre o inspetor se estiver recolhido). */
  onNodeOpen: (nodeId: string) => void
  /**
   * Quanto cada painel flutuante (biblioteca, inspetor, problemas + legenda)
   * cobre de cada borda do canvas. Controles e minimapa se afastam por esse
   * tanto para continuarem visiveis.
   */
  insets: { left: number; right: number; bottom: number }
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, setViewport, getNodesBounds, zoomIn, zoomOut } = useReactFlow()
  
  // Estado interno do ReactFlow para posições durante drag
  const [internalNodes, setInternalNodes] = useState<ComponentFlowNode[]>([])
  /** Ligacao clicada: ela e os dois blocos que ela une ficam em destaque. */
  const [edgeFocusId, setEdgeFocusId] = useState<string | null>(null)

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
    const nodeIssues: Record<string, Issue[]> = {}
    for (const i of issues) {
      for (const id of i.nodeIds ?? []) {
        ;(nodeIssues[id] ??= []).push(i)
        if (!nodeLevel[id] || rank[i.level] > rank[nodeLevel[id]]) nodeLevel[id] = i.level
      }
      for (const id of i.edgeIds ?? []) {
        if (!edgeLevel[id] || rank[i.level] > rank[edgeLevel[id]]) edgeLevel[id] = i.level
      }
    }
    return { nodeLevel, edgeLevel, nodeIssues }
  }, [issues])

  // Com algo selecionado, so ele, seus vizinhos e as ligacoes dele ficam em destaque.
  const focus = useMemo(() => {
    if (issueFocus) {
      const keep = new Set(issueFocus.nodeIds)
      const keepEdges = new Set(issueFocus.edgeIds)
      for (const e of edges) {
        if (keepEdges.has(e.id)) {
          keep.add(e.source)
          keep.add(e.target)
        }
      }
      return { nodes: keep, edges: keepEdges }
    }
    const picked = edgeFocusId ? edges.find((e) => e.id === edgeFocusId) : undefined
    if (picked && !connectFrom) {
      return { nodes: new Set([picked.source, picked.target]), edges: new Set([picked.id]) }
    }
    if (selectedNodeIds.length === 0 || connectFrom) return null
    const keep = new Set(selectedNodeIds)
    // Varios blocos (Shift): so eles, sem puxar os vizinhos; as ligacoes entre eles seguem visiveis.
    if (selectedNodeIds.length > 1) {
      const between = new Set<string>()
      for (const e of edges) {
        if (keep.has(e.source) && keep.has(e.target)) between.add(e.id)
      }
      return { nodes: keep, edges: between }
    }
    const keepEdges = new Set<string>()
    for (const e of edges) {
      if (keep.has(e.source) || keep.has(e.target)) keepEdges.add(e.id)
    }
    for (const e of edges) {
      if (keepEdges.has(e.id)) {
        keep.add(e.source)
        keep.add(e.target)
      }
    }
    return { nodes: keep, edges: keepEdges }
  }, [issueFocus, selectedNodeIds, connectFrom, edges, edgeFocusId])

  /** Enquadra os blocos na area livre do canvas, descontando as barras laterais e a inferior. */
  const frameNodes = (ids: string[], pad: number, maxZoom: number) => {
    const rect = wrapper.current?.getBoundingClientRect()
    if (!rect || ids.length === 0) return
    const bounds = getNodesBounds(ids)
    const availW = Math.max(rect.width - insets.left - insets.right - pad * 2, 100)
    const availH = Math.max(rect.height - insets.bottom - pad * 2, 100)
    const zoom = Math.min(availW / Math.max(bounds.width, 1), availH / Math.max(bounds.height, 1), maxZoom)
    const cx = insets.left + pad + availW / 2
    const cy = pad + availH / 2
    void setViewport(
      {
        x: cx - (bounds.x + bounds.width / 2) * zoom,
        y: cy - (bounds.y + bounds.height / 2) * zoom,
        zoom,
      },
      { duration: 400 },
    )
  }

  // Centraliza o bounding box dos blocos envolvidos, fora da area dos paineis.
  useEffect(() => {
    if (!issueFocus || !focus) return
    const targets = [...focus.nodes].filter((id) => nodes.some((n) => n.id === id))
    if (targets.length === 0) return
    frameNodes(targets, 60, 1.2)
    // So reenquadra quando o aviso muda, nao a cada edicao ou resize de painel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueFocus])

  /** Liga/desliga uma fonte ativa: o calculo de potencia refaz de onde a energia vem. */
  const onTogglePower = useCallback(
    (nodeId: string) =>
      onNodesChange(
        nodes.map((n) => (n.id === nodeId ? { ...n, off: n.off ? undefined : true } : n)),
      ),
    [nodes, onNodesChange],
  )

  const power = useMemo(
    () => (powerView ? computePower(library, nodes, edges) : null),
    [powerView, library, nodes, edges],
  )

  useEffect(() => {
    const ids = new Set(selectedNodeIds)
    const multi = selectedNodeIds.length > 1
    const incoming = incomingVoltages(library, nodes, edges)
    const nodePower = power?.nodes ?? {}
    const newNodes = nodes.flatMap((n) => {
      const component = library.byId[n.componentId]
      if (!component) return []
      const portInstances: Record<string, ReturnType<typeof portInstancesOf>> = {}
      if (expanded) {
        for (const p of component.ports) {
          const inst = portInstancesOf(library, nodes, edges, n, p)
          if (inst) portInstances[p.id] = inst
        }
      }
      return [
        {
          id: n.id,
          type: 'component' as const,
          position: n.position,
          selected: ids.has(n.id),
          className: focus && !focus.nodes.has(n.id) ? 'dimmed' : undefined,
          data: {
            component,
            label: nodeLabel(n, component),
            level: worst.nodeLevel[n.id] ?? null,
            issues: worst.nodeIssues[n.id] ?? [],
            arrangement: describePack(n, component),
            connected: edges.flatMap((e) =>
              e.source === n.id ? [e.sourcePort] : e.target === n.id ? [e.targetPort] : [],
            ),
            incoming: incoming[n.id] ?? {},
            portInstances,
            expanded,
            power: powerView ? (nodePower[n.id] ?? null) : null,
            idAsTitle,
            node: n,
            connecting: connectFrom !== null,
            isOrigin: connectFrom === n.id,
            multiSelected: multi,
            onStartConnect,
            onCancelConnect,
            onStartDisconnect,
            onRename,
            onTogglePower,
          },
        },
      ]
    })
    setInternalNodes(newNodes)
  }, [nodes, edges, library, selectedNodeIds, focus, worst, connectFrom, expanded, powerView, power, idAsTitle, onStartConnect, onCancelConnect, onStartDisconnect, onRename, onTogglePower])

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.flatMap<Edge>((e) => {
        // Visao de potencia: so as ligacoes que carregam energia, uma linha cada,
        // com a seta no sentido da corrente e a corrente num bullet no meio.
        if (power) {
          const flow = power.edges[e.id]
          const dir = power.direction[e.id]
          if (!flow || !dir) return []
          const level = worst.edgeLevel[e.id]
          const color =
            level === 'error' ? '#d14343' : level === 'warning' ? '#c98a12' : '#7a7a7a'
          return [
            {
              id: e.id,
              className: [
                focus && !focus.edges.has(e.id) ? 'dimmed' : '',
                flow.idle || flow.dead ? 'edge--idle' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined,
              source: dir.from.node.id,
              target: dir.to.node.id,
              sourceHandle: handleId('out', dir.from.port.id),
              targetHandle: handleId('in', dir.to.port.id),
              label: (
                <>
                  {formatCurrent(flow.mA, flow.partial)}
                  {flow.peak && flow.peak.mA > flow.mA ? (
                    <>
                      {' / '}
                      <tspan fill="#e0a060">{formatCurrent(flow.peak.mA, flow.peak.partial)}</tspan>
                    </>
                  ) : null}
                </>
              ),
              labelStyle: { fontSize: 10, fontWeight: 700, fill: 'var(--text)' },
              labelBgStyle: { fill: 'var(--panel)', stroke: color, strokeWidth: 1.2 },
              labelBgPadding: [6, 3] as [number, number],
              labelBgBorderRadius: 999,
              markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
              style: { stroke: color, strokeWidth: 2.5, strokeDasharray: flow.idle || flow.dead ? '5 4' : undefined },
            },
          ]
        }


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
          className: focus && !focus.edges.has(e.id) ? 'dimmed' : undefined,
          source: e.source,
          target: e.target,
          animated: level === 'error',
          labelStyle: { fontSize: 10, fill: color },
          labelBgStyle: { fill: 'var(--panel)', fillOpacity: 0.9 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
        }

        if (expanded) {
          const srcNode = nodes.find((n) => n.id === e.source)
          const tgtNode = nodes.find((n) => n.id === e.target)
          const tgtComp = library.byId[tgtNode?.componentId ?? '']
          const targetPort = tgtComp?.ports.find((p) => p.id === e.targetPort)
          // So preenche quando esta porta tem 2+ ligacoes simultaneas -- e so
          // aí que o card abre uma linha por instância (ver ComponentNode).
          const srcMulti =
            srcNode && port ? portInstancesOf(library, nodes, edges, srcNode, port) : null
          const tgtMulti =
            tgtNode && targetPort ? portInstancesOf(library, nodes, edges, tgtNode, targetPort) : null
          const srcPins = srcNode && srcComp && port ? pinsOf(srcNode, srcComp, port) : null
          const tgtPins = tgtNode && tgtComp && targetPort ? pinsOf(tgtNode, tgtComp, targetPort) : null

          let links = expandEdge(library, nodes, e).links
          // Sem par de pinos casados, cada pino do lado que tem pinagem sai para o
          // conector (ou para a bolinha da instancia) do outro lado.
          if (links.length === 0 && port && targetPort) {
            if (srcPins && !tgtPins) {
              links = srcPins.map((sp) => ({ id: `${e.id}::${sp.id}`, sourcePin: sp, targetPin: pinParaFio(targetPort, sp, srcPins) }))
            } else if (tgtPins && !srcPins) {
              links = tgtPins.map((tp) => ({ id: `${e.id}::${tp.id}`, sourcePin: pinParaFio(port, tp, tgtPins), targetPin: tp }))
            } else if (!srcPins && !tgtPins && (srcMulti || tgtMulti)) {
              links = [{ id: e.id, sourcePin: portPin(port), targetPin: portPin(targetPort) }]
            }
          }

          if (links.length > 0 && port && targetPort) {
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
              const fromPins = reversed ? tgtPins : srcPins
              const toPins = reversed ? srcPins : tgtPins

              // Porta sem pinagem so tem handle proprio quando abre em instancias.
              const handle = (
                role: 'out' | 'in',
                portId: string,
                pin: typeof fromPin,
                pins: typeof fromPins,
                multi: typeof fromMulti,
              ) =>
                pins
                  ? handleId(role, portId, multi ? `${e.id}|${pin.id}` : pin.id)
                  : multi
                    ? handleId(role, portId, `${e.id}|${pin.id}`)
                    : handleId(role, portId)

              return {
                ...base,
                id: l.id,
                source: fromNode,
                target: toNode,
                sourceHandle: handle('out', fromPort, fromPin, fromPins, fromMulti),
                targetHandle: handle('in', toPort, toPin, toPins, toMulti),
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
    [edges, nodes, library, worst, expanded, focus, power],
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
        // Basta tocar parte do card com o retângulo de seleção para entrar no conjunto.
        selectionMode={SelectionMode.Partial}
        onSelectionChange={({ nodes: sel }) => {
          if (sel.length > 0) setEdgeFocusId(null)
          onSelectionChange(sel.map((n) => n.id))
        }}
        onEdgeClick={(_, ed) => {
          if (connectFrom) return
          // No modo expandido a linha vem por condutor ("<ligacao>::<pino>").
          const base = edges.find((e) => e.id === ed.id || ed.id.startsWith(`${e.id}::`))
          setEdgeFocusId(base?.id ?? null)
        }}
        onNodeClick={(_, n) => {
          if (connectFrom && connectFrom !== n.id) onPickTarget(n.id)
        }}
        onNodeDoubleClick={(_, n) => onNodeOpen(n.id)}
        onPaneClick={() => {
          setEdgeFocusId(null)
          onClearIssueFocus()
          if (connectFrom) onCancelConnect()
        }}
        // Ligar e por clique, nao por arrasto entre conectores.
        nodesConnectable={false}
        // Ligando, clicar no destino nao o seleciona: o React Flow e o efeito dos nos
        // (que devolve a selecao da app) brigariam em loop e a tela ficaria vazia.
        elementsSelectable={!connectFrom}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const componentId = e.dataTransfer.getData('application/mecha-component')
          if (!componentId) return
          // clientX/Y sao coordenadas de tela; o fluxo tem pan e zoom proprios.
          const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
          onDrop(componentId, { x: p.x - NODE_W / 2, y: p.y - 40 })
        }}
        // Trackpad: dois dedos transladam, pinch (ctrl+wheel) da zoom. Com
        // panOnScroll a roda deixa de dar zoom; o pinch continua via zoomOnPinch.
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.05}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={16} size={1} />
        <Panel
          position="bottom-right"
          className="mecha-zoom"
          style={{ marginRight: 15 + insets.right, marginBottom: 15 + insets.bottom + 100, transition: PANEL_SHIFT }}
        >
          <button type="button" title="Menos zoom" aria-label="Menos zoom" onClick={() => zoomOut({ duration: 150 })}>−</button>
          <button type="button" title="Mais zoom" aria-label="Mais zoom" onClick={() => zoomIn({ duration: 150 })}>+</button>
          <button type="button" title="Enquadrar todos os componentes" aria-label="Enquadrar todos os componentes" onClick={() => frameNodes(nodes.map((n) => n.id), 40, 1)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" />
            </svg>
          </button>
        </Panel>
        <MiniMap
          pannable
          zoomable
          className="mecha-minimap"
          style={{ width: 150, height: 100, marginRight: 15 + insets.right, marginBottom: 15 + insets.bottom, transition: PANEL_SHIFT }}
        />
      </ReactFlow>
    </div>
  )
}
