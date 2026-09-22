/** Cores por protocolo, no espirito da legenda do diagrama de referencia. */
import type { Library, Port } from '../model/types'
import { ROLE_LABEL, roleOf, type ArchEdge, type ArchNode, type PortRole } from '../model/graph'

export const PROTOCOL_COLOR: Record<string, string> = {
  uart: '#1f7a6a',
  i2c: '#3b6fd4',
  spi: '#7c4bb5',
  usb: '#b5562f',
  can: '#0f7d3c',
  pwm: '#c98a12',
  gpio: '#6b7280',
  analog: '#a8489b',
  wireless: '#2d8fb0',
  hdmi: '#8a6b2f',
}

/** Os tres papeis, com a forma do conector junto: quadrado energia, circulo dados. */
const ROLES: { role: PortRole; cor: string }[] = [
  { role: 'in', cor: 'var(--role-in)' },
  { role: 'out', cor: 'var(--role-out)' },
  { role: 'bidir', cor: 'var(--role-bidir)' },
]

/**
 * A legenda so descreve o que esta de fato no diagrama atual: os papeis e os
 * tipos de ligacao usados pelas conexoes existentes. Sem conexoes, some.
 */
export default function Legend({
  library,
  nodes,
  edges,
}: {
  library: Library
  nodes: ArchNode[]
  edges: ArchEdge[]
}) {
  const portDaPonta = (nodeId: string, portId: string): Port | undefined => {
    const componentId = nodes.find((n) => n.id === nodeId)?.componentId
    return componentId
      ? library.byId[componentId]?.ports.find((p) => p.id === portId)
      : undefined
  }

  const roles = new Set<PortRole>()
  const protocols = new Set<string>()
  let power = false

  for (const e of edges) {
    const from = portDaPonta(e.source, e.sourcePort)
    const to = portDaPonta(e.target, e.targetPort)
    if (from) roles.add(roleOf(from))
    if (to) roles.add(roleOf(to))
    if (from?.kind === 'power' || to?.kind === 'power') power = true
    for (const p of [from, to]) {
      if (p?.kind === 'data' && p.protocol) protocols.add(p.protocol)
    }
  }

  const temPortas = roles.size > 0
  const temLigacoes = power || protocols.size > 0
  if (!temPortas && !temLigacoes) return null

  const protocolos = Object.keys(PROTOCOL_COLOR).filter((name) => protocols.has(name))
  const extras = [...protocols].filter((name) => !(name in PROTOCOL_COLOR))

  return (
    <div className="legend">
      {temPortas ? (
        <>
          <span className="legend__group">portas</span>
          {ROLES.filter(({ role }) => roles.has(role)).map(({ role, cor }) => (
            <div className="legend__row" key={role}>
              <svg width="26" height="12" aria-hidden="true">
                <rect x="1" y="3" width="7" height="7" rx="1.5" fill={cor} />
                <circle cx="18" cy="6.5" r="3.5" fill={cor} />
              </svg>
              <span>{ROLE_LABEL[role].toUpperCase()}</span>
            </div>
          ))}
        </>
      ) : null}

      {temLigacoes ? (
        <>
          <span className="legend__group">ligações</span>
          {power ? (
            <div className="legend__row">
              <svg width="34" height="10" aria-hidden="true">
                <line x1="0" y1="5" x2="34" y2="5" stroke="#7a7a7a" strokeWidth="2.5" />
              </svg>
              <span>Energia</span>
            </div>
          ) : null}
          {[...protocolos, ...extras].map((name) => (
            <div className="legend__row" key={name}>
              <svg width="34" height="10" aria-hidden="true">
                <line
                  x1="0"
                  y1="5"
                  x2="34"
                  y2="5"
                  stroke={PROTOCOL_COLOR[name] ?? '#7a7a7a'}
                  strokeWidth="1.6"
                  strokeDasharray="6 4"
                />
              </svg>
              <span>{name.toUpperCase()}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}
