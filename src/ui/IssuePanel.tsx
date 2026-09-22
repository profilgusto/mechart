import type { Issue } from '../model/types'

const LABEL: Record<Issue['level'], string> = {
  error: 'Erro',
  warning: 'Atenção',
  unverifiable: 'Não verificável',
}

const RULE: Record<Issue['rule'], string> = {
  voltage: 'tensão',
  protocol: 'protocolo',
  'port-count': 'portas',
  budget: 'corrente',
  topology: 'topologia',
  missing: 'falta ligar',
  pins: 'condutores',
}

export default function IssuePanel({
  issues,
  onFocus,
}: {
  issues: Issue[]
  onFocus: (nodeId: string) => void
}) {
  if (issues.length === 0) {
    return (
      <div className="issues issues--empty">
        Nenhum problema nas ligações atuais.
      </div>
    )
  }

  const counts = {
    error: issues.filter((i) => i.level === 'error').length,
    warning: issues.filter((i) => i.level === 'warning').length,
    unverifiable: issues.filter((i) => i.level === 'unverifiable').length,
  }

  return (
    <div className="issues">
      <div className="issues__head">
        {counts.error > 0 && <span className="tag tag--error">{counts.error} erro(s)</span>}
        {counts.warning > 0 && (
          <span className="tag tag--warning">{counts.warning} atenção</span>
        )}
        {counts.unverifiable > 0 && (
          <span className="tag tag--unverifiable">
            {counts.unverifiable} não verificável
          </span>
        )}
      </div>
      <ul className="issues__list">
        {issues.map((issue, i) => (
          <li key={i}>
            <button
              type="button"
              className={`issue issue--${issue.level}`}
              onClick={() => issue.nodeIds?.[0] && onFocus(issue.nodeIds[0])}
            >
              <span className="issue__badge">
                {LABEL[issue.level]} · {RULE[issue.rule]}
              </span>
              <span className="issue__msg">{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
