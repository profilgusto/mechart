import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { Issue, Library as Lib } from './model/types'
import type { ArchEdge, ArchNode } from './model/graph'
import { effectiveVoltage, nextNaming, nodeLabel, normalizeNames, resolveEdge } from './model/graph'
import { formatRange } from './data/normalize'
import { loadProject } from './data/load'
import {
  DEFAULT_PROJECT_NAME,
  parseProject,
  projectFileName,
  serializeProject,
  writeStoredProject,
  type ProjectFile,
} from './data/project'
import { validate } from './validation'
import { possibleConnections, type Candidate } from './model/pairing'
import ConnectionModal from './ui/ConnectionModal'
import ConfirmModal from './ui/ConfirmModal'
import DisconnectModal, { type DisconnectOption } from './ui/DisconnectModal'
import ProjectMenu from './ui/ProjectMenu'
import ProjectName from './ui/ProjectName'
import LibraryPanel from './ui/Library'
import Inspector from './ui/Inspector'
import Canvas from './ui/Canvas'
import IssuePanel, { issueKey } from './ui/IssuePanel'
import Legend from './ui/legend'
import ThemeToggle from './ui/ThemeToggle'
import { useResizable, useStoredFlag } from './ui/useResizable'

/** Altura fixa da legenda (ver .legend em styles.css) — a barra de problemas
 * flutua exatamente encostada nela, sem precisar medir nada em runtime. */
const LEGEND_H = 33

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

/** Desloca para o lado enquanto houver um bloco ocupando o ponto. */
function nudgeClear(base: { x: number; y: number }, nodes: ArchNode[]): { x: number; y: number } {
  let p = base
  for (let i = 0; i < 60; i++) {
    const taken = nodes.some(
      (n) => Math.abs(n.position.x - p.x) < 150 && Math.abs(n.position.y - p.y) < 60,
    )
    if (!taken) break
    p = { x: p.x + 200, y: p.y }
  }
  return p
}

export default function App() {
  const [library, setLibrary] = useState<Lib | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<ArchNode[]>([])
  const [edges, setEdges] = useState<ArchEdge[]>([])
  /** Nome do projeto, editavel na barra e usado no arquivo baixado. */
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME)
  /** Blocos selecionados. Com Shift, o React Flow acrescenta mais de um. */
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [libSelection, setLibSelection] = useState<string | null>(null)
  /** Preferencia de visualizacao, lembrada neste navegador. */
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem('mechart:expanded') === '1'
    } catch {
      return false
    }
  })
  /** Preferencia de card: id como titulo em vez do tipo level-0. */
  const [idAsTitle, setIdAsTitle] = useState(() => {
    try {
      return localStorage.getItem('mechart:idAsTitle') === '1'
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
  /** Acao que so roda depois que o usuario confirma descartar o projeto aberto. */
  const [pending, setPending] = useState<
    | { title: string; message: string; confirmLabel: string; run: () => void }
    | null
  >(null)

  /** Larguras/altura dos paineis, arrastaveis e lembradas neste navegador. */
  const libWidth = useResizable({ storageKey: 'mechart:libWidth', initial: 260, min: 180, max: 480, axis: 'x' })
  const inspWidth = useResizable({
    storageKey: 'mechart:inspWidth',
    initial: 340,
    min: 260,
    max: 560,
    axis: 'x',
    sign: -1,
  })
  const issuesHeight = useResizable({
    storageKey: 'mechart:issuesHeight',
    initial: 200,
    min: 80,
    max: 480,
    axis: 'y',
    sign: -1,
  })

  /** Cada painel pode ser escondido, sobrando so o botao-aba na borda. */
  const [libCollapsed, setLibCollapsed] = useStoredFlag('mechart:libCollapsed')
  const [inspCollapsed, setInspCollapsed] = useStoredFlag('mechart:inspCollapsed')
  const [issuesCollapsed, setIssuesCollapsed] = useStoredFlag('mechart:issuesCollapsed')

  const [ignoredIssues, setIgnoredIssues] = useState<Set<string>>(new Set())
  const [showIgnored, setShowIgnored] = useState(false)
  /** Lista de ignoradas para gravar no projeto; omitida quando vazia. */
  const ignoredList = useMemo(() => [...ignoredIssues], [ignoredIssues])

  const loaded = useRef(false)
  /** O app abriu no projeto em branco padrao, ainda sem nada do usuario. */
  const pristineBlank = useRef(false)

  /** Preenchido pelo Canvas: devolve o centro da viewport em coordenadas do fluxo. */
  const canvasCenter = useRef<(() => { x: number; y: number }) | null>(null)

  useEffect(() => {
    loadProject()
      .then(({ library, project }) => {
        setLibrary(library)
        if (project) {
          setProjectName(project.name)
          setNodes(normalizeNames(project.nodes))
          setEdges(project.edges)
          setIgnoredIssues(new Set(project.ignoredIssues))
        }
        // Sem copia local, o mechart nasce num projeto novo em branco.
        pristineBlank.current = !project
        loaded.current = true
      })
      .catch((e: unknown) => setError(String(e)))
  }, [])

  // Salva o projeto no navegador, com debounce. Num site estatico nao ha
  // servidor: o localStorage e a unica persistencia automatica, e o download do
  // JSON (menu Arquivo) e a forma de levar o projeto para fora do navegador.
  // O projeto em branco padrao com que o mechart abre nao e gravado enquanto o
  // usuario nao mexer, para nao sobrepor uma copia local valida so por abrir o
  // app. Qualquer edicao (ou "Novo projeto") libera a gravacao.
  useEffect(() => {
    if (!loaded.current) return
    const untouchedBlank =
      nodes.length === 0 &&
      edges.length === 0 &&
      (!projectName || projectName === DEFAULT_PROJECT_NAME)
    if (pristineBlank.current && untouchedBlank) return

    const t = setTimeout(() => {
      const project: ProjectFile = { name: projectName, nodes, edges }
      if (ignoredList.length > 0) project.ignoredIssues = ignoredList
      writeStoredProject(project)
      pristineBlank.current = false
    }, 600)
    return () => clearTimeout(t)
  }, [projectName, nodes, edges, ignoredList])

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

  const [activeIssue, setActiveIssue] = useState<Issue | null>(null)
  const clearIssueFocus = useCallback(() => setActiveIssue(null), [])
  const issueFocus = useMemo(
    () => (activeIssue ? { nodeIds: activeIssue.nodeIds ?? [], edgeIds: activeIssue.edgeIds ?? [] } : null),
    [activeIssue],
  )

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
      localStorage.setItem('mechart:expanded', expanded ? '1' : '0')
    } catch {
      // modo privado: a preferencia simplesmente nao persiste
    }
  }, [expanded])

  useEffect(() => {
    try {
      localStorage.setItem('mechart:idAsTitle', idAsTitle ? '1' : '0')
    } catch {
      // modo privado: a preferencia simplesmente nao persiste
    }
  }, [idAsTitle])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(t)
  }, [flash])

  const issues = useMemo(
    () => (library ? validate(library, nodes, edges) : []),
    [library, nodes, edges],
  )

  const activeIssues = useMemo(
    () => issues.filter((i) => !ignoredIssues.has(issueKey(i))),
    [issues, ignoredIssues],
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
        path: `${nodeLabel(from.node, from.component)}.${from.port.label ?? from.port.id} → ${nodeLabel(to.node, to.component)}.${to.port.label ?? to.port.id}`,
        detail,
        note: from.port.note ?? to.port.note,
      })
    }

    return { node, options }
  }, [library, disconnecting, nodes, edges])

  const addNode = useCallback((componentId: string, position: { x: number; y: number }) => {
    setNodes((prev) => {
      const { label, renames } = nextNaming(prev, componentId)
      return [
        ...prev.map((x) => (renames[x.id] ? { ...x, label: renames[x.id] } : x)),
        { id: `${componentId}#${Date.now().toString(36)}`, componentId, position, label },
      ]
    })
  }, [])

  const renameNode = useCallback((id: string, label: string) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, label } : n)))
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

  /** Ha um projeto em edicao? Vazio = nada a descartar. */
  const hasProject = nodes.length > 0 || edges.length > 0

  /** Fecha qualquer interacao em curso e troca o projeto inteiro. */
  const replaceGraph = useCallback((next: ProjectFile) => {
    setProjectName(next.name)
    setNodes(normalizeNames(next.nodes))
    setEdges(next.edges)
    setIgnoredIssues(new Set(next.ignoredIssues))
    setShowIgnored(false)
    setSelectedNodeIds([])
    setLibSelection(null)
    setConnectFrom(null)
    setChoices(null)
    setDisconnecting(null)
    // Acao explicita do usuario: o projeto (mesmo em branco) deve ser gravado.
    pristineBlank.current = false
    // Novo projeto e carregar substituem a copia local na hora, sem esperar o
    // debounce: o fail-safe do navegador ja passa a valer o projeto recem-aberto.
    writeStoredProject(next)
  }, [])

  const doNewProject = useCallback(() => {
    replaceGraph({ name: DEFAULT_PROJECT_NAME, nodes: [], edges: [] })
    setFlash({ tone: 'ok', text: 'Novo projeto em branco' })
  }, [replaceGraph])

  const doLoadProject = useCallback(
    (project: ProjectFile) => {
      replaceGraph(project)
      setFlash({ tone: 'ok', text: `Projeto carregado: ${project.name}` })
    },
    [replaceGraph],
  )

  /** Novo projeto: so pergunta se ha algo aberto para descartar. */
  const requestNewProject = useCallback(() => {
    if (!hasProject) {
      doNewProject()
      return
    }
    setPending({
      title: 'Novo projeto',
      message: 'Há um projeto aberto. Descartar as alterações e começar um projeto em branco?',
      confirmLabel: 'Descartar e criar',
      run: doNewProject,
    })
  }, [hasProject, doNewProject])

  /** Carregar projeto: le e valida o arquivo; confirma antes se ha projeto aberto. */
  const requestLoadProject = useCallback(
    (file: File) => {
      file
        .text()
        .then((text) => {
          const parsed = parseProject(text)
          if (!parsed.ok) {
            setFlash({ tone: 'erro', text: parsed.error })
            return
          }
          if (!hasProject) {
            doLoadProject(parsed.project)
            return
          }
          setPending({
            title: 'Carregar projeto',
            message: `Há um projeto aberto. Descartar as alterações e abrir "${file.name}"?`,
            confirmLabel: 'Descartar e abrir',
            run: () => doLoadProject(parsed.project),
          })
        })
        .catch(() => setFlash({ tone: 'erro', text: 'Não foi possível ler o arquivo.' }))
    },
    [hasProject, doLoadProject],
  )

  /** Baixar projeto: o JSON do projeto atual, nomeado pelo nome + timestamp. */
  const downloadProject = useCallback(() => {
    const project: ProjectFile = { name: projectName, nodes, edges }
    if (ignoredList.length > 0) project.ignoredIssues = ignoredList
    const blob = new Blob([serializeProject(project)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = projectFileName(projectName)
    a.click()
    URL.revokeObjectURL(url)
    setFlash({ tone: 'ok', text: 'Download do projeto iniciado' })
  }, [projectName, nodes, edges, ignoredList])

  // Cmd/Ctrl + S equivale a "Arquivo -> Baixar projeto" (e evita o "salvar página" do navegador).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        downloadProject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [downloadProject])

  if (error) return <div className="center">Erro ao carregar o projeto: {error}</div>
  if (!library) return <div className="center">Carregando catálogo…</div>

  const primarySelectedId =
    selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null
  const inspectedNode = primarySelectedId
    ? (nodes.find((n) => n.id === primarySelectedId) ?? null)
    : null
  const inspected =
    (inspectedNode ? (library.byId[inspectedNode.componentId] ?? null) : null) ??
    (libSelection ? (library.byId[libSelection] ?? null) : null)

  /** Faixa ocupada na base (legenda + problemas): as barras laterais param
   * acima dela, para flutuarem so sobre a area de edicao do diagrama. */
  const bottomH = LEGEND_H + (issuesCollapsed ? 0 : issuesHeight.size)

  return (
    <div className="app" style={{ '--bottom-h': `${bottomH}px` } as CSSProperties}>
      <main className="workspace">
        <header className="toolbar">
          <strong>mechart</strong>
          <ProjectName name={projectName} onRename={setProjectName} />
          <span className="toolbar__divider" aria-hidden="true" />
          <ProjectMenu
            onNew={requestNewProject}
            onLoadFile={requestLoadProject}
            onDownload={downloadProject}
          />
          <div className="toolbar__modes" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              className={`mode${!expanded ? ' mode--on' : ''}`}
              aria-pressed={!expanded}
              data-tip="visão em blocos — card compacto, sem os condutores"
              onClick={() => setExpanded(false)}
            >
              blocos
            </button>
            <button
              type="button"
              className={`mode${expanded ? ' mode--on' : ''}`}
              aria-pressed={expanded}
              data-tip="visão em condutores — abre os pinos e as ligações"
              onClick={() => setExpanded(true)}
            >
              condutores
            </button>
          </div>

          <div className="toolbar__modes" role="group" aria-label="Nome principal do card">
            <button
              type="button"
              className={`mode${!idAsTitle ? ' mode--on' : ''}`}
              aria-pressed={!idAsTitle}
              data-tip="título do card pelo tipo do componente"
              onClick={() => setIdAsTitle(false)}
            >
              tipo
            </button>
            <button
              type="button"
              className={`mode${idAsTitle ? ' mode--on' : ''}`}
              aria-pressed={idAsTitle}
              data-tip="título do card pelo nome da instância"
              onClick={() => setIdAsTitle(true)}
            >
              nome
            </button>
          </div>

          <span className={`toolbar__hint${flash ? ` toolbar__hint--${flash.tone}` : ''}`}>
            {flash
              ? flash.text
              : connectFrom
                ? 'clique no bloco de destino — Esc cancela'
                : 'clique num bloco · Shift+clique seleciona vários para mover em bloco'}
          </span>
          <ThemeToggle />
        </header>

        <div className="diagram-area">
          <ReactFlowProvider>
            <Canvas
              library={library}
              nodes={nodes}
              edges={edges}
              issues={activeIssues}
              issueFocus={issueFocus}
              onClearIssueFocus={clearIssueFocus}
              selectedNodeIds={selectedNodeIds}
              connectFrom={connectFrom}
              expanded={expanded}
              idAsTitle={idAsTitle}
              onNodesChange={setNodes}
              onSelectionChange={(ids) => {
                syncSelection(ids)
                if (ids.length > 0) {
                  setLibSelection(null)
                  // Clicar num bloco envolvido no aviso mantem o realce; qualquer outro o desfaz.
                  if (issueFocus) {
                    const involved = new Set(issueFocus.nodeIds)
                    for (const e of edges) {
                      if (issueFocus.edgeIds.includes(e.id)) {
                        involved.add(e.source)
                        involved.add(e.target)
                      }
                    }
                    if (!ids.every((id) => involved.has(id))) clearIssueFocus()
                  }
                }
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
              onRename={renameNode}
              onPickTarget={pickTarget}
              onNodeOpen={(id) => {
                selectOnly(id)
                setInspCollapsed(false)
              }}
              centerRef={canvasCenter}
              insets={{
                left: libCollapsed ? 0 : libWidth.size,
                right: inspCollapsed ? 0 : inspWidth.size,
                bottom: LEGEND_H + (issuesCollapsed ? 0 : issuesHeight.size),
              }}
            />
          </ReactFlowProvider>

          <div
            className={`overlay-panel overlay-panel--left${libCollapsed ? ' overlay-panel--collapsed' : ''}`}
            style={{ width: libWidth.size }}
            inert={libCollapsed || undefined}
          >
            <LibraryPanel
              components={library.components}
              selectedId={libSelection}
              onSelect={(id) => {
                setLibSelection(id)
                setSelectedNodeIds([])
              }}
              onAdd={(id) =>
                addNode(id, nudgeClear(canvasCenter.current?.() ?? freeSpot(nodes), nodes))
              }
            />
          </div>
          {!libCollapsed && (
            <div
              className="resize-handle resize-handle--v"
              style={{ left: libWidth.size }}
              role="separator"
              aria-orientation="vertical"
              onPointerDown={libWidth.onPointerDown}
              onDoubleClick={libWidth.reset}
            />
          )}
          <button
            type="button"
            className="panel-tab panel-tab--left"
            style={{ left: libCollapsed ? 0 : libWidth.size + 6 }}
            onClick={() => setLibCollapsed((v) => !v)}
            aria-label={libCollapsed ? 'Mostrar biblioteca' : 'Esconder biblioteca'}
            title={libCollapsed ? 'Mostrar biblioteca' : 'Esconder biblioteca'}
          >
            {libCollapsed ? '›' : '‹'}
          </button>

          <div
            className={`overlay-panel overlay-panel--right${inspCollapsed ? ' overlay-panel--collapsed' : ''}`}
            style={{ width: inspWidth.size }}
            inert={inspCollapsed || undefined}
          >
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
          {!inspCollapsed && (
            <div
              className="resize-handle resize-handle--v"
              style={{ right: inspWidth.size }}
              role="separator"
              aria-orientation="vertical"
              onPointerDown={inspWidth.onPointerDown}
              onDoubleClick={inspWidth.reset}
            />
          )}
          <button
            type="button"
            className="panel-tab panel-tab--right"
            style={{ right: inspCollapsed ? 0 : inspWidth.size + 6 }}
            onClick={() => setInspCollapsed((v) => !v)}
            aria-label={inspCollapsed ? 'Mostrar inspetor' : 'Esconder inspetor'}
            title={inspCollapsed ? 'Mostrar inspetor' : 'Esconder inspetor'}
          >
            {inspCollapsed ? '‹' : '›'}
          </button>
        </div>
      </main>

      <Legend library={library} nodes={nodes} edges={edges} />

      <div
        className={`overlay-panel overlay-panel--bottom${issuesCollapsed ? ' overlay-panel--collapsed' : ''}`}
        style={{ height: issuesHeight.size }}
        inert={issuesCollapsed || undefined}
      >
        <IssuePanel
          issues={issues}
          ignored={ignoredIssues}
          showIgnored={showIgnored}
          onToggleIgnored={() => setShowIgnored((v) => !v)}
          onIgnore={(issue) => {
            setIgnoredIssues((prev) => new Set(prev).add(issueKey(issue)))
            setActiveIssue(null)
          }}
          active={activeIssue}
          onFocus={(issue) => {
            setSelectedNodeIds([])
            setActiveIssue(issue)
          }}
        />
      </div>
      {!issuesCollapsed && (
        <div
          className="resize-handle resize-handle--h"
          style={{ bottom: LEGEND_H + issuesHeight.size }}
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={issuesHeight.onPointerDown}
          onDoubleClick={issuesHeight.reset}
        />
      )}
      <button
        type="button"
        className="panel-tab panel-tab--bottom"
        style={{ bottom: LEGEND_H + (issuesCollapsed ? 0 : issuesHeight.size) }}
        onClick={() => setIssuesCollapsed((v) => !v)}
        aria-label={issuesCollapsed ? 'Mostrar problemas' : 'Esconder problemas'}
        title={issuesCollapsed ? 'Mostrar problemas' : 'Esconder problemas'}
      >
        {issuesCollapsed ? '▴' : '▾'}
      </button>

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

      {pending ? (
        <ConfirmModal
          title={pending.title}
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          danger
          onConfirm={() => {
            const run = pending.run
            setPending(null)
            run()
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  )
}
