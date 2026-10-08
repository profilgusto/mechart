import { useEffect, useRef, useState } from 'react'

/**
 * Menu "Arquivo" da barra superior: novo projeto, carregar do computador e
 * baixar o JSON do projeto atual. O item de carregar dispara um seletor de
 * arquivo escondido e entrega o `File` para o App validar.
 */
export default function ProjectMenu({
  onNew,
  onLoadFile,
  onDownload,
}: {
  onNew: () => void
  onLoadFile: (file: File) => void
  onDownload: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className={`menu__button${open ? ' menu__button--open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Arquivo
        <span className="menu__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="menu__list" role="menu">
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(onNew)}
          >
            Novo projeto
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => fileInput.current?.click())}
          >
            Carregar projeto…
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(onDownload)}
          >
            Baixar projeto
          </button>
        </div>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="menu__file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onLoadFile(f)
        }}
      />
    </div>
  )
}
