import { useEffect, useState } from 'react'
import type { Issue } from '../model/types'

export const LABEL: Record<Issue['level'], string> = {
  error: 'Erro',
  warning: 'Atenção',
  unverifiable: 'Não verificável',
}

export const RULE: Record<Issue['rule'], string> = {
  voltage: 'tensão',
  protocol: 'protocolo',
  'port-count': 'portas',
  budget: 'corrente',
  topology: 'topologia',
  missing: 'falta ligar',
  pins: 'condutores',
  address: 'endereços',
  pinout: 'pinos',
}

export const issueKey = (i: Issue) => `${i.level}|${i.rule}|${i.message}`

export default function IssuePanel({
  issues,
  active,
  onFocus,
  ignored,
  showIgnored,
  onIgnore,
  onToggleIgnored,
  selectedNodeIds,
}: {
  issues: Issue[]
  active: Issue | null
  onFocus: (issue: Issue) => void
  ignored: Set<string>
  showIgnored: boolean
  onIgnore: (issue: Issue) => void
  onToggleIgnored: () => void
  selectedNodeIds: string[]
}) {
  const [confirm, setConfirm] = useState<{ issue: Issue; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setConfirm(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm])

  const isIgnored = (i: Issue) => ignored.has(issueKey(i))
  const ignoredCount = issues.filter(isIgnored).length
  const live = issues.filter((i) => !isIgnored(i))
  const visible = showIgnored ? issues : live

  // Com componentes selecionados, as mensagens que os envolvem sobem ao topo
  // (ordem original preservada) e as demais ficam esmaecidas.
  const hasSelection = selectedNodeIds.length > 0
  const isRelated = (i: Issue) => !!i.nodeIds?.some((id) => selectedNodeIds.includes(id))
  const shown = hasSelection
    ? [...visible.filter(isRelated), ...visible.filter((i) => !isRelated(i))]
    : visible

  const counts = {
    error: live.filter((i) => i.level === 'error').length,
    warning: live.filter((i) => i.level === 'warning').length,
    unverifiable: live.filter((i) => i.level === 'unverifiable').length,
  }

  return (
    <div className="issues">
      <div className="issues__head">
        <h2 className="issues__title">Painel de análise do projeto</h2>
        {counts.error > 0 && <span className="tag tag--error">{counts.error} erro(s)</span>}
        {counts.warning > 0 && (
          <span className="tag tag--warning">{counts.warning} atenção</span>
        )}
        {counts.unverifiable > 0 && (
          <span className="tag tag--unverifiable">
            {counts.unverifiable} não verificável
          </span>
        )}
        {ignoredCount > 0 && (
          <button
            type="button"
            className={`tag tag--ignored${showIgnored ? ' tag--ignored-on' : ''}`}
            aria-pressed={showIgnored}
            data-tip={showIgnored ? 'Ocultar mensagens ignoradas' : 'Ver mensagens ignoradas'}
            onClick={onToggleIgnored}
          >
            {ignoredCount} {ignoredCount === 1 ? 'ignorada' : 'ignoradas'}
          </button>
        )}
      </div>
      {shown.length === 0 && (
        <div className="issues__empty">Nenhum problema encontrado no projeto.</div>
      )}
      <ul className="issues__list">
        {shown.map((issue) => {
          const key = issueKey(issue)
          const off = ignored.has(key)
          const dim = hasSelection && !isRelated(issue)
          const selected = issue === active || (active != null && issueKey(active) === key)
          return (
            <li key={key} className="issues__item">
              <button
                type="button"
                className={`issue issue--${issue.level}${selected ? ' issue--active' : ''}${off ? ' issue--ignored' : ''}${dim ? ' issue--dim' : ''}`}
                aria-pressed={selected}
                onClick={() => (issue.nodeIds?.length || issue.edgeIds?.length) && onFocus(issue)}
              >
                <span className="issue__badge">
                  {LABEL[issue.level]} · {RULE[issue.rule]}
                </span>
                <span className="issue__msg">{issue.message}</span>
              </button>
              {selected && !off && (
                <button
                  type="button"
                  className="issue__ignore"
                  title="Ignorar mensagem"
                  aria-label="Ignorar mensagem"
                  onClick={(e) => setConfirm({ issue, x: e.clientX, y: e.clientY })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {confirm && (
        <>
          <div className="confirm-backdrop" onClick={() => setConfirm(null)} />
          <div
            className="confirm-pop"
            role="alertdialog"
            style={{
              left: Math.min(confirm.x, window.innerWidth - 260),
              top: Math.max(8, confirm.y - 90),
            }}
          >
            <p>Você deseja mesmo ignorar esta mensagem?</p>
            <div className="confirm-pop__actions">
              <button
                type="button"
                className="confirm-pop__yes"
                onClick={() => {
                  onIgnore(confirm.issue)
                  setConfirm(null)
                }}
              >
                Sim
              </button>
              <button type="button" className="confirm-pop__cancel" autoFocus onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
