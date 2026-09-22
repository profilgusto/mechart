import { useEffect, useRef, useState } from 'react'

/** Uma ligacao existente que pode ser desfeita, apresentada como uma opcao. */
export type DisconnectOption = {
  id: string
  kind: 'power' | 'data'
  title: string
  path: string
  detail?: string
  note?: string
}

/**
 * Lista as ligacoes de um bloco e deixa marcar quais desfazer. Espelha o modal
 * de conexao, mas opera sobre ligacoes que ja existem.
 */
export default function DisconnectModal({
  options,
  nodeLabel,
  onConfirm,
  onCancel,
}: {
  options: DisconnectOption[]
  nodeLabel: string
  onConfirm: (ids: string[]) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const count = selected.size
  const ids = options.filter((o) => selected.has(o.id)).map((o) => o.id)

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
          Remover conexões
        </h2>
        <p className="modal__sub">
          {options.length} {options.length === 1 ? 'conexão' : 'conexões'} em {nodeLabel}. Marque
          quais desfazer.
        </p>

        <ul className="modal__list">
          {options.map((o, i) => {
            const on = selected.has(o.id)
            const classes = ['option', `option--${o.kind}`, on ? 'option--on' : '']
              .filter(Boolean)
              .join(' ')

            return (
              <li key={o.id}>
                <button
                  ref={i === 0 ? first : undefined}
                  type="button"
                  className={classes}
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(o.id)}
                >
                  <span className="option__check" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span className="option__body">
                    <span className="option__title">{o.title}</span>
                    <span className="option__path">{o.path}</span>
                    {o.detail ? <span className="option__detail">{o.detail}</span> : null}
                    {o.note ? <span className="option__note">{o.note}</span> : null}
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
              onClick={() => setSelected(new Set(options.map((o) => o.id)))}
              disabled={count === options.length}
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
              className="modal__confirm modal__confirm--danger"
              onClick={() => onConfirm(ids)}
              disabled={count === 0}
            >
              {count <= 1 ? 'Remover conexão' : `Remover ${count} conexões`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
