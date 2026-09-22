import { useEffect, useMemo, useRef, useState } from 'react'
import type { Candidate } from '../model/pairing'
import type { Library, Port } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'

type PortRef = { nodeId: string; portId: string }

const refsOf = (c: Candidate): PortRef[] => [
  { nodeId: c.source, portId: c.sourcePort },
  { nodeId: c.target, portId: c.targetPort },
]

const refKey = (r: PortRef) => `${r.nodeId}\u0000${r.portId}`

type Context = {
  portOf: (ref: PortRef) => Port | undefined
  /** Ligacoes ja existentes por porta, somadas as escolhidas no modal. */
  used: Map<string, number>
}

/**
 * Por que uma opcao nao pode entrar junto com as ja escolhidas: a porta ja
 * gastou as ligacoes que aceita, ou uma porta mutuamente exclusiva esta em uso.
 * Devolve o rotulo da porta em conflito, ou null quando a opcao cabe.
 */
function conflictReason(c: Candidate, chosen: Candidate[], ctx: Context): string | null {
  const selUsage = new Map<string, number>()
  const selPorts = new Map<string, Set<string>>()

  for (const s of chosen) {
    for (const r of refsOf(s)) {
      selUsage.set(refKey(r), (selUsage.get(refKey(r)) ?? 0) + 1)
      if (!selPorts.has(r.nodeId)) selPorts.set(r.nodeId, new Set())
      selPorts.get(r.nodeId)!.add(r.portId)
    }
  }

  for (const r of refsOf(c)) {
    const port = ctx.portOf(r)
    if (!port) continue

    const usadas = (ctx.used.get(refKey(r)) ?? 0) + (selUsage.get(refKey(r)) ?? 0)
    if (usadas + 1 > port.count) return port.label ?? port.id

    const no = selPorts.get(r.nodeId)
    if (no) {
      const choque = [...no].find((outra) => {
        if (port.exclusiveWith?.includes(outra)) return true
        const op = ctx.portOf({ nodeId: r.nodeId, portId: outra })
        return op?.exclusiveWith?.includes(r.portId) ?? false
      })
      if (choque) {
        const outra = ctx.portOf({ nodeId: r.nodeId, portId: choque })
        return outra?.label ?? choque
      }
    }
  }

  return null
}

/**
 * So aparece quando ha mais de uma forma de ligar dois blocos -- por exemplo o
 * sensor de CO2, que fala UART ou I2C pelos mesmos pinos. Permite marcar mais de
 * uma forma e criar todas de uma vez.
 */
export default function ConnectionModal({
  candidates,
  library,
  nodes,
  edges,
  onConfirm,
  onCancel,
}: {
  candidates: Candidate[]
  library: Library
  nodes: ArchNode[]
  edges: ArchEdge[]
  onConfirm: (cs: Candidate[]) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const first = useRef<HTMLButtonElement>(null)

  const ctx = useMemo<Context>(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const portOf = (ref: PortRef): Port | undefined => {
      const node = nodeById.get(ref.nodeId)
      const comp = node ? library.byId[node.componentId] : undefined
      return comp?.ports.find((p) => p.id === ref.portId)
    }
    const used = new Map<string, number>()
    for (const e of edges) {
      for (const r of [
        { nodeId: e.source, portId: e.sourcePort },
        { nodeId: e.target, portId: e.targetPort },
      ]) {
        used.set(refKey(r), (used.get(refKey(r)) ?? 0) + 1)
      }
    }
    return { portOf, used }
  }, [library, nodes, edges])

  /** Motivo do conflito de cada opcao (null quando cabe), dado o que ja foi marcado. */
  const conflicts = useMemo(() => {
    const chosen = candidates.filter((c) => selected.has(c.id))
    const m = new Map<string, string | null>()
    for (const c of candidates) {
      m.set(c.id, selected.has(c.id) ? null : conflictReason(c, chosen, ctx))
    }
    return m
  }, [candidates, selected, ctx])

  const toggle = (c: Candidate) => {
    if (conflicts.get(c.id)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(c.id)) next.delete(c.id)
      else next.add(c.id)
      return next
    })
  }

  /** Marca o maior conjunto possivel: adiciona em ordem, pulando o que conflita. */
  const selectAll = () => {
    const chosen: Candidate[] = []
    for (const c of candidates) {
      if (selected.has(c.id)) {
        chosen.push(c)
        continue
      }
      if (conflictReason(c, chosen, ctx)) continue
      chosen.push(c)
    }
    setSelected(new Set(chosen.map((c) => c.id)))
  }

  const count = selected.size
  const chosen = candidates.filter((c) => selected.has(c.id))

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal__backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title" className="modal__title">
          Como ligar?
        </h2>
        <p className="modal__sub">
          {candidates.length} formas possíveis. Marque uma ou mais conexões.
        </p>

        <ul className="modal__list">
          {candidates.map((c, i) => {
            const conflito = conflicts.get(c.id) ?? null
            const on = selected.has(c.id)
            const classes = [
              'option',
              `option--${c.kind}`,
              on ? 'option--on' : '',
              conflito ? 'option--blocked' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <li key={c.id}>
                <button
                  ref={i === 0 ? first : undefined}
                  type="button"
                  className={classes}
                  role="checkbox"
                  aria-checked={on}
                  disabled={Boolean(conflito)}
                  title={conflito ? `Indisponível junto com as demais: ${conflito}` : undefined}
                  onClick={() => toggle(c)}
                >
                  <span className="option__check" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span className="option__body">
                    <span className="option__title">{c.title}</span>
                    <span className="option__path">{c.path}</span>
                    {c.detail ? <span className="option__detail">{c.detail}</span> : null}
                    {c.note ? <span className="option__note">{c.note}</span> : null}
                    {conflito ? (
                      <span className="option__blocked">já usado: {conflito}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="modal__actions">
          <div className="modal__actions-left">
            <button
              type="button"
              className="modal__ghost"
              onClick={selectAll}
              disabled={count === candidates.length}
            >
              Selecionar todas
            </button>
            <button
              type="button"
              className="modal__ghost"
              onClick={() => setSelected(new Set())}
              disabled={count === 0}
            >
              Limpar
            </button>
          </div>
          <div className="modal__actions-right">
            <button type="button" className="modal__cancel" onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className="modal__confirm"
              onClick={() => onConfirm(chosen)}
              disabled={count === 0}
            >
              {count <= 1 ? 'Criar conexão' : `Criar ${count} conexões`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
