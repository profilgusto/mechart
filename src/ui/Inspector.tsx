import type { Component, Port } from '../model/types'
import { packTotals, roleOf, ROLE_LABEL, type ArchNode } from '../model/graph'
import { formatRange, toRange, CATEGORY_COLOR, CATEGORY_LABEL } from '../data/normalize'

const RANGE_KEYS = new Set(['min', 'nominal', 'nom', 'max', 'note'])

/** Um objeto e "so uma faixa" quando so tem min/nominal/max (+ note). */
function isRangeObject(v: Record<string, unknown>): boolean {
  const keys = Object.keys(v)
  return keys.length > 0 && keys.every((k) => RANGE_KEYS.has(k))
}

function humanize(key: string): string {
  return key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function Unknown({ note }: { note?: string }) {
  return (
    <>
      <span className="spec__val spec__val--unknown">a confirmar</span>
      {note ? <div className="spec__note">{note}</div> : null}
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="spec__row">
      <span className="spec__key">{label}</span>
      {children}
    </div>
  )
}

function Value({
  k,
  v,
  units,
}: {
  k: string
  v: unknown
  units: Record<string, string>
}) {
  const unit = units[k]

  // A regra do projeto: null nunca vira zero nem sumico -- vira "a confirmar".
  if (v === null || v === undefined) {
    return (
      <Row label={humanize(k)}>
        <Unknown />
      </Row>
    )
  }

  if (typeof v === 'number') {
    return (
      <Row label={humanize(k)}>
        <span className="spec__val">
          {v}
          {unit ? ` ${unit}` : ''}
        </span>
      </Row>
    )
  }

  if (typeof v === 'string') {
    return (
      <Row label={humanize(k)}>
        <span className="spec__val">{v}</span>
      </Row>
    )
  }

  if (typeof v === 'boolean') {
    return (
      <Row label={humanize(k)}>
        <span className="spec__val">{v ? 'sim' : 'não'}</span>
      </Row>
    )
  }

  if (Array.isArray(v)) {
    const allPrimitive = v.every((x) => typeof x !== 'object' || x === null)
    if (allPrimitive) {
      return (
        <div className="spec__group">
          <div className="spec__grouptitle">{humanize(k)}</div>
          <ul className="spec__list">
            {v.map((x, i) => (
              <li key={i}>{x === null ? 'a confirmar' : String(x)}</li>
            ))}
          </ul>
        </div>
      )
    }
    return (
      <div className="spec__group">
        <div className="spec__grouptitle">{humanize(k)}</div>
        {v.map((x, i) => (
          <Tree key={i} obj={x as Record<string, unknown>} units={units} />
        ))}
      </div>
    )
  }

  const obj = v as Record<string, unknown>

  if (isRangeObject(obj)) {
    const r = toRange(obj)
    return (
      <Row label={humanize(k)}>
        {r.unknown ? (
          <Unknown note={r.note} />
        ) : (
          <>
            <span className="spec__val">{formatRange(r, unit)}</span>
            {r.note ? <div className="spec__note">{r.note}</div> : null}
          </>
        )}
      </Row>
    )
  }

  return (
    <div className="spec__group">
      <div className="spec__grouptitle">{humanize(k)}</div>
      <Tree obj={obj} units={units} />
    </div>
  )
}

function Tree({
  obj,
  units,
}: {
  obj: Record<string, unknown>
  units: Record<string, string>
}) {
  return (
    <div className="spec">
      {Object.entries(obj).map(([k, v]) => (
        <Value key={k} k={k} v={v} units={units} />
      ))}
    </div>
  )
}


function PortRow({ port }: { port: Port }) {
  const spec: string[] = []

  if (port.kind === 'power') {
    spec.push(port.v ? formatRange(toRange({ ...port.v }), 'V') : 'tensão a confirmar')
    if (port.draw_min_mA != null) spec.push(`mínimo ${port.draw_min_mA} mA`)
    if (port.draw_mA != null) spec.push(`consome ${port.draw_mA} mA`)
    else if (port.dir === 'sink') spec.push('consumo a confirmar')
    if (port.peak_mA != null) spec.push(`pico/exigido ${port.peak_mA} mA`)
    if (port.supply_mA != null) spec.push(`entrega ${port.supply_mA} mA`)
    else if (port.dir === 'source') spec.push('capacidade a confirmar')
  } else {
    spec.push(port.protocol ?? 'dados')
    if (port.vbus === 'device' && port.draw_mA != null) spec.push(`consome ${port.draw_mA} mA do VBUS`)
    if (port.vbus === 'host') {
      spec.push(port.supply_mA != null ? `entrega ${port.supply_mA} mA no VBUS` : 'VBUS: capacidade a confirmar')
    }
    spec.push(port.level_v != null ? `${port.level_v} V` : 'nível a confirmar')
  }
  if (port.count > 1) spec.push(`${port.count} ligações`)

  const uncertain = spec.some((s) => s.includes('a confirmar'))

  const papel = roleOf(port)

  return (
    <div className={`port port--${papel}`}>
      <div className="port__head">
        <span className={`port__dot port__dot--${port.kind}`} />
        <span className="port__name">{port.label ?? port.id}</span>
        <span className="port__dir">
          {ROLE_LABEL[papel]}
          {port.required ? (port.exclusiveWith?.length ? ' · obrigatória (alternativa)' : ' · obrigatória') : ''}
        </span>
      </div>
      <div className={`port__spec${uncertain ? ' port__spec--uncertain' : ''}`}>
        {spec.join(' · ')}
      </div>
      {port.note ? <div className="spec__note">{port.note}</div> : null}
      {port.src ? <div className="port__src">fonte: {port.src}</div> : null}
    </div>
  )
}


/** Resumo somado de um pack: 3S2P, 6 células, 11,1 V, 6700 mAh, 74,4 Wh, 285 g. */
function PackSummary({ node, component }: { node: ArchNode; component: Component }) {
  const t = packTotals(node, component)
  if (!t) return null

  const linhas: [string, string][] = [
    ['Arranjo', `${t.notation} · ${t.units} ${t.units === 1 ? 'unidade' : 'unidades'}`],
  ]
  if (t.voltage) linhas.push(['Tensão do pack', formatRange(t.voltage, 'V')])
  if (t.capacity_mAh != null) linhas.push(['Capacidade', `${t.capacity_mAh} mAh`])
  if (t.energy_Wh != null) linhas.push(['Energia', `${t.energy_Wh} Wh`])
  if (t.weight_g != null) linhas.push(['Peso das células', `${t.weight_g} g`])

  return (
    <div className="pack">
      {linhas.map(([k, v]) => (
        <div className="pack__row" key={k}>
          <span className="pack__key">{k}</span>
          <span className="pack__val">{v}</span>
        </div>
      ))}
      {component.instance.unit?.capacity_src ? (
        <div className="port__src">por unidade: {component.instance.unit.capacity_src}</div>
      ) : null}
    </div>
  )
}

/** Ajustes da instancia no quadro: arranjo do pack e tensao regulada da fonte. */
function NodeConfig({
  node,
  component,
  onChange,
}: {
  node: ArchNode
  component: Component
  onChange: (patch: Partial<ArchNode>) => void
}) {
  const { pack, adjustable, selectableOutput, operatingRange } = component.instance
  const defineSaida = Boolean(adjustable || selectableOutput)
  const external = component.external

  const arranjo = (campo: 'series' | 'parallel', rotulo: string, dica: string) => (
    <div className="spec__row">
      <label className="spec__key" htmlFor={`cfg-${campo}`}>
        {rotulo}
        <span className="cfg__hint">{dica}</span>
      </label>
      <input
        id={`cfg-${campo}`}
        className="cfg__input cfg__input--num"
        type="number"
        min={1}
        max={24}
        value={node[campo] ?? 1}
        onChange={(e) => {
          const n = Math.max(1, Math.round(Number(e.target.value) || 1))
          onChange({ [campo]: n > 1 ? n : undefined })
        }}
      />
    </div>
  )

  return (
    <>
      <h2>Esta instância</h2>
      <div className="spec__row">
        <label className="spec__key" htmlFor="cfg-label">
          Rótulo
        </label>
        <input
          id="cfg-label"
          className="cfg__input"
          value={node.label ?? ''}
          placeholder={component.id}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
        />
      </div>

      {external ? (
        <>
          <div className="spec__row">
            <label className="spec__key" htmlFor="cfg-v">
              Tensão da fonte (V)
            </label>
            <input
              id="cfg-v"
              className="cfg__input cfg__input--num"
              type="number"
              step="0.1"
              min={0}
              placeholder="não declarada"
              value={node.setVoltage ?? ''}
              onChange={(e) => {
                const v = e.target.value
                onChange({ setVoltage: v === '' ? undefined : Number(v) })
              }}
            />
          </div>
          <div className="spec__row">
            <label className="spec__key" htmlFor="cfg-i">
              Corrente da fonte (mA)
            </label>
            <input
              id="cfg-i"
              className="cfg__input cfg__input--num"
              type="number"
              min={0}
              placeholder="não declarada"
              value={node.setCurrent ?? ''}
              onChange={(e) => {
                const v = e.target.value
                onChange({ setCurrent: v === '' ? undefined : Number(v) })
              }}
            />
          </div>
          <div className="spec__note">
            Esta alimentação vem de fora do projeto — os valores são do adapter que
            você vai ligar, não de um datasheet. Sem eles, a tensão e a corrente
            ficam “a confirmar” e a validação não pode fechar.
          </div>
        </>
      ) : null}

      {pack ? (
        <>
          {arranjo('series', 'Em série (S)', 'multiplica a tensão')}
          {arranjo('parallel', 'Em paralelo (P)', 'multiplica capacidade e corrente')}
          <PackSummary node={node} component={component} />
        </>
      ) : null}

      {operatingRange ? (
        <>
          {(['useMin', 'useMax'] as const).map((campo) => (
            <div className="spec__row" key={campo}>
              <label className="spec__key" htmlFor={`cfg-${campo}`}>
                {campo === 'useMin' ? 'Saída mínima usada (V)' : 'Saída máxima usada (V)'}
              </label>
              <input
                id={`cfg-${campo}`}
                className="cfg__input cfg__input--num"
                type="number"
                step="0.1"
                min={0}
                placeholder={campo === 'useMin' ? '0' : 'faixa da ficha'}
                value={node[campo] ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  onChange({ [campo]: v === '' ? undefined : Number(v) })
                }}
              />
            </div>
          ))}
          <div className="spec__note">
            A saída segue a tensão em VM e o PWM varia a média de 0 até ela. Declare a faixa que
            você vai realmente aplicar (ex. 0–12 V) para que os motores sejam verificados contra
            ela, e não contra os 4,5–13,5 V da ficha. Só vale com o máximo preenchido.
          </div>
        </>
      ) : null}

      {defineSaida ? (
        <div className="spec__row">
          <label className="spec__key" htmlFor="cfg-v">
            {adjustable ? 'Saída ajustada (V)' : 'Saída escolhida (V)'}
          </label>
          <input
            id="cfg-v"
            className="cfg__input cfg__input--num"
            type="number"
            step="0.1"
            min={0}
            placeholder={adjustable ? 'não ajustada' : 'não escolhida'}
            value={node.setVoltage ?? ''}
            onChange={(e) => {
              const v = e.target.value
              onChange({ setVoltage: v === '' ? undefined : Number(v) })
            }}
          />
          <div className="spec__note">
            {adjustable
              ? 'O MP1584EN sai de fábrica num ajuste arbitrário. Declare aqui a tensão em que o trimmer foi regulado para que as cargas sejam verificadas contra ela.'
              : 'Saída fixa, escolhida na compra (3,3 / 4,2 / 5 / 6 / 9 / 10 / 12 V). Declare a versão para que as cargas sejam verificadas contra ela.'}
          </div>
        </div>
      ) : null}
    </>
  )
}

export default function Inspector({
  component,
  units,
  node,
  onNodeChange,
}: {
  component: Component | null
  units: Record<string, string>
  node?: ArchNode | null
  onNodeChange?: (patch: Partial<ArchNode>) => void
}) {
  if (!component) {
    return (
      <aside className="panel panel--right">
        <div className="center">Selecione um componente na biblioteca para ver a ficha técnica.</div>
      </aside>
    )
  }

  const { description, ...rest } = component.raw

  return (
    <aside className="panel panel--right">
      <h1 style={{ color: CATEGORY_COLOR[component.category] }}>{component.id}</h1>
      <p className="subtitle">{String(description ?? '')}</p>
      <p className="subtitle">{CATEGORY_LABEL[component.category]}</p>

      {component.external ? (
        <div className="banner">
          Fronteira do projeto: esta alimentação vem de fora do sistema e não entra no
          BOM. Declare a tensão e a corrente no inspetor da instância para que as
          cargas sejam verificadas.
        </div>
      ) : null}

      {node && onNodeChange ? (
        <NodeConfig node={node} component={component} onChange={onNodeChange} />
      ) : null}

      {component.ports.length === 0 ? (
        <div className="banner">
          Portas ainda não declaradas para este componente em <code>data/components/{component.id}.json</code>.
        </div>
      ) : (
        <>
          <h2>Portas ({component.ports.length})</h2>
          {component.ports.map((p) => (
            <PortRow key={p.id} port={p} />
          ))}
        </>
      )}

      <h2>Ficha técnica</h2>
      <Tree obj={rest} units={units} />
    </aside>
  )
}
