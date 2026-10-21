import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Issue } from '../model/types'
import { LABEL, RULE } from './IssuePanel'

type Pos = { x: number; y: number }

/** Perto do mouse, sem sair da janela. */
function place(p: Pos, w: number, h: number): React.CSSProperties {
  return {
    left: Math.max(8, Math.min(p.x + 14, window.innerWidth - w - 8)),
    top: Math.max(8, Math.min(p.y + 14, window.innerHeight - h - 8)),
  }
}

export default function NodeIssueBadge({
  level,
  issues,
}: {
  level: Issue['level']
  issues: Issue[]
}) {
  const [hover, setHover] = useState<Pos | null>(null)
  const [open, setOpen] = useState<Pos | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.issue-pop, .node__issue')) setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        className={`node__issue node__issue--${level} nodrag`}
        aria-label="Há uma questão com este componente"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          e.stopPropagation()
          setHover(null)
          setOpen({ x: e.clientX, y: e.clientY })
        }}
      >
        {level === 'unverifiable' ? '?' : '!'}
      </button>
      {hover && !open
        ? createPortal(
            <div className="issue-tip" style={place(hover, 220, 56)}>
              Há uma questão com este componente. Clique para ver os detalhes.
            </div>,
            document.body,
          )
        : null}
      {open
        ? createPortal(
            <div className="issue-pop" role="dialog" style={place(open, 300, 280)}>
              <div className="issue-pop__head">
                <span>{issues.length === 1 ? 'Questão neste componente' : `${issues.length} questões neste componente`}</span>
                <button type="button" className="issue-pop__close" onClick={() => setOpen(null)} aria-label="Fechar">
                  ×
                </button>
              </div>
              {issues.map((issue, i) => (
                <div key={i} className={`issue-pop__item issue-pop__item--${issue.level}`}>
                  <span className="issue-pop__badge">
                    {LABEL[issue.level]} · {RULE[issue.rule]}
                  </span>
                  {issue.message}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
