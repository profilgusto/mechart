import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { Library as Lib } from './model/types'
import type { ArchEdge, ArchGraph, ArchNode } from './model/graph'
import { effectiveVoltage, nodeLabel, resolveEdge } from './model/graph'
import { formatRange } from './data/normalize'
import { loadProject, saveDiagram } from './data/load'
import { validate } from './validation'
import { possibleConnections, type Candidate } from './model/pairing'
import ConnectionModal from './ui/ConnectionModal'
import DisconnectModal, { type DisconnectOption } from './ui/DisconnectModal'
import LibraryPanel from './ui/Library'
import Inspector from './ui/Inspector'
import Canvas from './ui/Canvas'
import IssuePanel from './ui/IssuePanel'
import Legend from './ui/legend'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Posicao para um no adicionado pelo botao. Vai para uma faixa livre abaixo de
 * tudo que ja esta no quadro, senao o novo bloco nasce em cima de outro.
 */
function freeSpot(nodes: ArchNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 60, y: 60 }

  const bottom = Math.max(...nodes.map((n) => n.position.y))
  const left = Math.min(...nodes.map((n) => n.position.x))
  const onRow = nodes.filter((n) => Math.abs(n.position.y - (bottom + 140)) < 60)

  return { x: left + onRow.length * 190, y: bottom + 140 }
}

export default function App() {
  const [library, setLibrary] = useState<Lib | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<ArchNode[]>([])
  const [edges, setEdges] = useState<ArchEdge[]>([])
  /** Blocos selecionados. Com Shift, o React Flow acrescenta mais de um. */
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [libSelection, setLibSelection] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>('idle')
  /** Preferencia de visualizacao, lembrada neste navegador. */
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem('karu:expanded') === '1'
    } catch {
      return false
    }
  })
  /** Bloco de origem enquanto o usuario escolhe o destino. */
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  /** Opcoes quando ha mais de uma forma de ligar os dois blocos. */
  const [choices, setChoices] = useState<Candidate[] | null>(null)
  /** Bloco cujas ligacoes estao sendo removidas. */
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  /** Recado curto na barra: por que a ligacao nao deu, ou o que foi criado. */
  const [flash, setFlash] = useState<{ tone: 'ok' | 'erro'; text: string } | null>(null)

  const loaded = useRef(false)

  useEffect(() => {
    loadProject()
      .then(({ library, diagram }) => {
        setLibrary(library)
        const g = diagram as ArchGraph | null
        if (g?.nodes) setNodes(g.nodes)
        if (g?.edges) setEdges(g.edges)
        loaded.current = true
      })
      .catch((e: unknown) => setError(String(e)))
  }, [])

  // Salva o diagrama em arquitetura/diagrama.json, com debounce.
  useEffect(() => {
    if (!loaded.current) return
    setSave('saving')
    const t = setTimeout(() => {
      saveDiagram({ nodes, edges })
        .then(() => setSave('saved'))
        .catch(() => setSave('error'))
    }, 600)
    return () => clearTimeout(t)
  }, [nodes, edges])

  const cancelConnect = useCallback(() => {
    setConnectFrom(null)
    setChoices(null)
  }, [])

  const cancelDisconnect = useCallback(() => setDisconnecting(null), [])

  const startDisconnect = useCallback((nodeId: string) => {
    setFlash(null)
    setConnectFrom(null)
    setChoices(null)
    setDisconnecting(nodeId)
  }, [])

  const selectOnly = useCallback((id: string | null) => {
    setSelectedNodeIds(id ? [id] : [])
  }, [])

  /**
   * Espelha a selecao do React Flow no estado da app. Compara como conjunto para
   * nao disparar re-render (e um novo ciclo de selecao) quando nada mudou.
   */
  const syncSelection = useCallback((ids: string[]) => {
    setSelectedNodeIds((prev) =>
      prev.length === ids.length && prev.every((id) => ids.includes(id)) ? prev : ids,
    )
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelConnect()
        cancelDisconnect()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelConnect, cancelDisconnect])

  useEffect(() => {
    try {
      localStorage.setItem('karu:expanded', expanded ? '1' : '0')
    } catch {
      // modo privado: a preferencia simplesmente nao persiste
    }
  }, [expanded])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(t)
  }, [flash])

  const issues = useMemo(
    () => (library ? validate(library, nodes, edges) : []),
    [library, nodes, edges],
  )

  /** Ligacoes do bloco em remocao, apresentadas como opcoes para desfazer. */
  const disconnectOptions = useMemo(() => {
    if (!library || !disconnecting) return null
    const node = nodes.find((n) => n.id === disconnecting)
    if (!node) return null

    const options: DisconnectOption[] = []
    for (const e of edges) {
      if (e.source !== disconnecting && e.target !== disconnecting) continue
      const r = resolveEdge(library, nodes, e)
      if (!r) continue
      const { from, to } = r
      const isPower = from.port.kind === 'power'
      const detail = isPower
        ? (() => {
            const v = effectiveVoltage(from.node, from.port)
            return v ? formatRange(v, 'V') : undefined
          })()
        : from.port.protocol?.toUpperCase()
      options.push({
        id: e.id,
        kind: isPower ? 'power' : 'data',
        title: isPower ? 'Energia' : (from.port.protocol ?? 'dados').toUpperCase(),
        path: `${nodeLabel(from.node, from.component)}.${from.port.id} → ${nodeLabel(to.node, to.component)}.${to.port.id}`,
        detail,
        note: from.port.note ?? to.port.note,
      })
    }

    return { node, options }
  }, [library, disconnecting, nodes, edges])

  const addNode = useCallback((componentId: string, position: { x: number; y: number }) => {
    setNodes((prev) => {
      const n = prev.filter((x) => x.componentId === componentId).length
      return [
        ...prev,
        {
          id: `${componentId}#${Date.now().toString(36)}`,
          componentId,
          position,
          label: n > 0 ? `${componentId} (${n + 1})` : undefined,
        },
      ]
    })
  }, [])

  const commitMany = useCallback(
    (list: Candidate[]) => {
      if (list.length === 0) return
      const novas: ArchEdge[] = list.map((c) => ({
        id: c.id,
        source: c.source,
        sourcePort: c.sourcePort,
        target: c.target,
        targetPort: c.targetPort,
      }))
      setEdges((prev) => {
        const known = new Set(prev.map((e) => e.id))
        return [...prev, ...novas.filter((e) => !known.has(e.id))]
      })
      setFlash({
        tone: 'ok',
        text:
          list.length === 1
            ? `Ligado: ${list[0].title} · ${list[0].path}`
            : `${list.length} conexões criadas`,
      })
      cancelConnect()
    },
    [cancelConnect],
  )

  /**
   * O usuario escolheu o destino. Se ha uma unica forma de ligar, liga; se ha
   * varias, pergunta; se nao ha nenhuma, explica por que.
   */
  const pickTarget = useCallback(
    (targetId: string) => {
      if (!library || !connectFrom) return
      const r = possibleConnections(library, nodes, edges, connectFrom, targetId)

      if (!r.ok) {
        setFlash({ tone: 'erro', text: r.reason })
        cancelConnect()
        return
      }
      if (r.candidates.length === 1) {
        commitMany([r.candidates[0]])
        return
      }
      setChoices(r.candidates)
    },
    [library, connectFrom, nodes, edges, commitMany, cancelConnect],
  )

  const deleteEdges = useCallback((ids: string[]) => {
    const drop = new Set(ids)
    setEdges((prev) => prev.filter((e) => !drop.has(e.id)))
  }, [])

  const confirmDisconnect = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      deleteEdges(ids)
      setFlash({
        tone: 'ok',
        text: ids.length === 1 ? 'Conexão removida' : `${ids.length} conexões removidas`,
      })
      setDisconnecting(null)
    },
    [deleteEdges],
  )

  if (error) return <div className="center">Erro ao carregar o projeto: {error}</div>
  if (!library) return <div className="center">Carregando components.json…</div>

  const primarySelectedId =
    selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null
  const inspectedNode = primarySelectedId
    ? (nodes.find((n) => n.id === primarySelectedId) ?? null)
    : null
  const inspected =
    (inspectedNode ? (library.byId[inspectedNode.componentId] ?? null) : null) ??
    (libSelection ? (library.byId[libSelection] ?? null) : null)

  return (
    <div className="app">
      <LibraryPanel
        components={library.components}
        selectedId={libSelection}
        onSelect={(id) => {
          setLibSelection(id)
          setSelectedNodeIds([])
        }}
        onAdd={(id) => addNode(id, freeSpot(nodes))}
      />

      <main className="main">
        <header className="toolbar">
          <strong>Karu-un · arquitetura</strong>
          <div className="toolbar__modes" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              className={`mode${!expanded ? ' mode--on' : ''}`}
              aria-pressed={!expanded}
              onClick={() => setExpanded(false)}
            >
              blocos
            </button>
            <button
              type="button"
              className={`mode${expanded ? ' mode--on' : ''}`}
              aria-pressed={expanded}
              onClick={() => setExpanded(true)}
            >
              condutores
            </button>
          </div>

          <span className={`toolbar__hint${flash ? ` toolbar__hint--${flash.tone}` : ''}`}>
            {flash
              ? flash.text
              : connectFrom
                ? 'clique no bloco de destino — Esc cancela'
                : 'clique num bloco · Shift+clique seleciona vários para mover em bloco'}
          </span>
          <span className={`toolbar__save toolbar__save--${save}`}>
            {save === 'saving'
              ? 'salvando…'
              : save === 'saved'
                ? 'salvo em arquitetura/diagrama.json'
                : save === 'error'
                  ? 'falha ao salvar'
                  : ''}
          </span>
        </header>

        <ReactFlowProvider>
          <Canvas
            library={library}
            nodes={nodes}
            edges={edges}
            issues={issues}
            selectedNodeIds={selectedNodeIds}
            connectFrom={connectFrom}
            expanded={expanded}
            onNodesChange={setNodes}
            onSelectionChange={(ids) => {
              syncSelection(ids)
              if (ids.length > 0) setLibSelection(null)
            }}
            onDrop={addNode}
            onDeleteEdges={deleteEdges}
            onStartConnect={(id) => {
              setFlash(null)
              setDisconnecting(null)
              setConnectFrom(id)
            }}
            onCancelConnect={cancelConnect}
            onStartDisconnect={startDisconnect}
            onPickTarget={pickTarget}
          />
        </ReactFlowProvider>

        <Legend library={library} nodes={nodes} edges={edges} />
        <IssuePanel issues={issues} onFocus={selectOnly} />
      </main>

      {choices ? (
        <ConnectionModal
          candidates={choices}
          library={library}
          nodes={nodes}
          edges={edges}
          onConfirm={commitMany}
          onCancel={cancelConnect}
        />
      ) : null}

      {disconnectOptions && disconnectOptions.options.length > 0 ? (
        <DisconnectModal
          options={disconnectOptions.options}
          nodeLabel={nodeLabel(disconnectOptions.node, library.byId[disconnectOptions.node.componentId])}
          onConfirm={confirmDisconnect}
          onCancel={cancelDisconnect}
        />
      ) : null}

      <Inspector
        component={inspected}
        units={library.units}
        node={inspectedNode}
        onNodeChange={
          inspectedNode
            ? (patch) =>
                setNodes((prev) =>
                  prev.map((n) => (n.id === inspectedNode.id ? { ...n, ...patch } : n)),
                )
            : undefined
        }
      />
    </div>
  )
}
