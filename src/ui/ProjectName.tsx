import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PROJECT_NAME } from '../data/project'

/**
 * Nome do projeto na barra superior. Passar o mouse revela um lapis; clicar
 * nele troca o nome por um campo editavel. Enter ou sair do campo confirma,
 * Esc cancela. Nome vazio cai no padrao.
 */
export default function ProjectName({
  name,
  onRename,
}: {
  name: string
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  /** Marca um Esc para que o blur que ele dispara nao confirme o rascunho. */
  const cancelled = useRef(false)

  useEffect(() => {
    if (!editing) return
    input.current?.focus()
    input.current?.select()
  }, [editing])

  const start = () => {
    cancelled.current = false
    setDraft(name)
    setEditing(true)
  }

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      setEditing(false)
      return
    }
    setEditing(false)
    const next = draft.trim() || DEFAULT_PROJECT_NAME
    if (next !== name) onRename(next)
  }

  if (editing) {
    return (
      <span className="project-name project-name--editing">
        <input
          ref={input}
          className="project-name__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') input.current?.blur()
            else if (e.key === 'Escape') {
              cancelled.current = true
              setEditing(false)
            }
          }}
          onBlur={commit}
          aria-label="Nome do projeto"
        />
      </span>
    )
  }

  return (
    <span className="project-name">
      <span className="project-name__label" title={name}>
        {name}
      </span>
      <button
        type="button"
        className="project-name__edit"
        onClick={start}
        aria-label="Renomear projeto"
        title="Renomear projeto"
      >
        ✎
      </button>
    </span>
  )
}
