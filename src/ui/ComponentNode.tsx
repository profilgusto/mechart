import { useState } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { Component, Issue, Pin, Port } from '../model/types'
import { CATEGORY_COLOR, formatRangeCompact, rangeBounds } from '../data/normalize'
import { nodeLabel, handleId, rolesOf, roleOf, missingRequired, effectiveVoltage, type ArchNode } from '../model/graph'
import { pinsOf, type PortInstance } from '../model/pins'
import NodeIssueBadge from './NodeIssueBadge'
import { getTypeHierarchy } from '../model/component-type'
import {
  POWER_ROLE_COLOR,
  POWER_ROLE_LABEL,
  formatCurrent,
  formatTriple,
  formatPower,
  type Flow,
  type Level,
  type NodePower,
  type PortPower,
} from '../model/power'

export type ComponentNodeData = {
  component: Component
  label: string
  level: 'error' | 'warning' | 'unverifiable' | null
  /** Problemas de validação que envolvem este bloco. */
  issues: Issue[]
  /** "3S2P · 6 células", quando o bloco representa um pack. */
  arrangement: string | null
  /** Ids das portas que ja tem alguma ligacao. */
  connected: string[]
  /** Por porta de entrada: a tensão que chega, vinda de quem alimenta. */
  incoming: Record<string, { text: string; range: boolean; level: 'bad' | 'warn' | null }>
  /** Portas UART com 2+ ligações simultâneas: uma linha por instância física. */
  portInstances: Record<string, PortInstance[] | null>
  connecting: boolean
  isOrigin: boolean
  /** Mais de um bloco selecionado: selecao em bloco, nao edicao de um so. */
  multiSelected: boolean
  /** Modo expandido: as portas ligadas abrem nos seus condutores. */
  expanded: boolean
  /** Visao de potencia: papel do bloco e a corrente em cada porta. Nulo na visao comum. */
  power: NodePower | null
  /** Card mostra o id do componente como titulo, em vez do tipo level-0. */
  idAsTitle: boolean
  node: ArchNode
  onStartConnect: (nodeId: string) => void
  onCancelConnect: () => void
  onStartDisconnect: (nodeId: string) => void
  onRename: (nodeId: string, label: string) => void
  /** Liga/desliga uma fonte ativa (visao de potencia). */
  onTogglePower: (nodeId: string) => void
}

export type ComponentFlowNode = Node<ComponentNodeData, 'component'>

/** Sem valor confirmado a porta ganha tratamento visual proprio. */
function incerta(port: Port): boolean {
  return port.kind === 'power' ? !port.v : port.level_v == null
}

/**
 * Uma linha por porta, com o conector na borda do bloco. E o que responde
 * "qual fio vai em qual pino": a aresta chega visivelmente na porta nomeada.
 */
/** Um condutor: e nele que a linha chega no modo expandido. */
function PinRow({
  port,
  pin,
  recebe,
  envia,
  papel,
}: {
  port: Port
  pin: Pin
  recebe: boolean
  envia: boolean
  papel: string
}) {
  return (
    <div className={`pinrow pinrow--${papel}`} title={pin.note}>
      {recebe ? (
        <Handle
          id={handleId('in', port.id, pin.id)}
          type="target"
          position={Position.Left}
          className="mecha-handle mecha-handle--pin"
        />
      ) : null}
      <span className="pinrow__label">
        <span className="pinrow__id">{pin.id}</span>{' '}
        <span className="pinrow__signal">{pin.signal}</span>
      </span>
      {envia ? (
        <Handle
          id={handleId('out', port.id, pin.id)}
          type="source"
          position={Position.Right}
          className="mecha-handle mecha-handle--pin"
        />
      ) : null}
    </div>
  )
}

/**
 * Uma porta UART com 2+ ligações simultâneas: cada instância (pino físico
 * diferente, ex. UART0 vs UART5) ganha seu próprio bloco, com Rx recebendo
 * pela esquerda e Tx saindo pela direita -- nunca os dois no mesmo pino.
 */
const GENERIC_LABEL = /^ligação \d+$/

function InstanceRows({ port, instances }: { port: Port; instances: PortInstance[] }) {
  return (
    <div className="node__uart-instances">
      {instances.map((inst) => (
        <div key={inst.edgeId} className="uartinst">
          <div className={`uartinst__head${GENERIC_LABEL.test(inst.label) ? ' uartinst__head--center' : ''}`}>
            {GENERIC_LABEL.test(inst.label) ? null : <span className="uartinst__label">{inst.label}</span>}
            <span className="uartinst__other">↔ {inst.otherLabel}</span>
          </div>
          {inst.pins.map(({ pin, role }) => (
            <div key={pin.id} className={`pinrow pinrow--${role}`} title={pin.note}>
              {role === 'in' ? (
                <Handle
                  id={handleId('in', port.id, `${inst.edgeId}|${pin.id}`)}
                  type="target"
                  position={Position.Left}
                  className="mecha-handle mecha-handle--pin"
                />
              ) : null}
              <span className="pinrow__label">
                <span className="pinrow__id">{pin.id}</span>{' '}
                <span className="pinrow__signal">{pin.signal}</span>
              </span>
              {role === 'out' ? (
                <Handle
                  id={handleId('out', port.id, `${inst.edgeId}|${pin.id}`)}
                  type="source"
                  position={Position.Right}
                  className="mecha-handle mecha-handle--pin"
                />
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Bullet com a corrente que passa pela porta (entra pela esquerda, sai pela direita). */
function FlowBullet({ flow, dir }: { flow: Flow; dir: 'in' | 'out' }) {
  const w = formatPower(flow.mW, flow.partial)
  const peak = flow.peak && flow.peak.mA > flow.mA ? flow.peak : null
  return (
    <span
      className={`prow__flow prow__flow--${dir}${flow.mA === 0 && !flow.partial ? ' prow__flow--zero' : ''}`}
      title={`${dir === 'in' ? 'corrente que entra' : 'corrente que sai'} por esta porta (nominal)${w ? ` · ${w}` : ''}\nmín / nominal / pico: ${formatTriple(flow)}`}
    >
      {dir === 'in' ? '→ ' : ''}
      {formatCurrent(flow.mA, flow.partial)}
      {peak ? (
        <>
          {' / '}
          <span className="prow__peak">{formatCurrent(peak.mA, peak.partial)}</span>
        </>
      ) : null}
      {dir === 'out' ? ' →' : ''}
    </span>
  )
}

/** Rodape da visao de potencia: o que o bloco recebe e o que entrega, com o limite quando existe. */
function PowerFooter({ power, off, onToggle }: { power: NodePower; off: boolean; onToggle: () => void }) {
  const { totalIn, totalOut } = power
  // Corrente e potencia sempre juntas, no mesmo cenario (nominal, pico, minimo).
  const pair = (l: Level) => {
    const w = formatPower(l.mW, l.partial)
    return (
      <>
        <span className="pwfoot__a">{formatCurrent(l.mA, l.partial)}</span>
        <span className="pwfoot__w">{w ?? '—'}</span>
      </>
    )
  }
  const line = (label: string, f: Flow, limit?: number | null, tol?: { mA: number; note?: string }) => {
    const over = limit != null && f.mA > limit
    const overPeak = !over && limit != null && (f.peak?.mA ?? 0) > limit
    const peak = f.peak && f.peak.mA > f.mA ? f.peak : null
    const min = f.min && f.min.mA < f.mA ? f.min : null
    const cls = over ? ' pwfoot__line--over' : overPeak ? ' pwfoot__line--peak' : ''
    return (
      <div className={`pwfoot__line${cls}`} key={label}>
        <div className="pwfoot__title">
          <span className="pwfoot__label">{label}</span>
          {limit != null ? (
            <span className="pwfoot__limit" title="corrente máxima que esta saída aguenta">
              limite {formatCurrent(limit)}
            </span>
          ) : null}
        </div>
        {tol ? (
          <div
            className="pwfoot__tol"
            title="corrente de pico que a saída tolera só por instantes (datasheet); acima do limite contínuo, mas não sustentável"
          >
            tolera pico {formatCurrent(tol.mA)}
            {tol.note ? ` · ${tol.note}` : ''}
          </div>
        ) : null}
        <div className="pwfoot__grid">
          {peak ? (
            <>
              <span className="pwfoot__tag pwfoot__tag--peak">pico</span>
              <span className="pwfoot__pk">{pair(peak)}</span>
            </>
          ) : null}
          <span className="pwfoot__tag">nominal</span>
          {pair(f)}
          {min ? (
            <>
              <span className="pwfoot__tag pwfoot__tag--min">mín</span>
              <span className="pwfoot__mn">{pair(min)}</span>
            </>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div className="node__pwfoot">
      <div className="pwfoot__head">
        <span className="pwfoot__role">
          {POWER_ROLE_LABEL[power.role]}
          {power.role === 'active' && off ? ' · desligado' : ''}
        </span>
        {power.role === 'active' ? (
          <button
            type="button"
            role="switch"
            aria-checked={!off}
            className={`pwswitch nodrag${off ? '' : ' pwswitch--on'}`}
            title={off ? 'Ligar: volta a injetar tensão e corrente' : 'Desligar: refaz o cálculo sem esta fonte'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            <span className="pwswitch__knob" />
          </button>
        ) : null}
      </div>
      {power.role !== 'active' && !power.energized ? (
        <span className="pwfoot__dead">sem alimentação — nenhuma fonte chega aqui</span>
      ) : null}
      {totalIn ? line('recebe', totalIn) : null}
      {totalOut ? line('fornece', totalOut, totalOut.limit, totalOut.peakLimit ? { mA: totalOut.peakLimit, note: totalOut.peakNote } : undefined) : null}
      {!totalIn && !totalOut ? <span className="pwfoot__none">sem ligação de energia</span> : null}
    </div>
  )
}

function PortRow({
  port,
  ligada,
  falta,
  volt,
  range,
  inVolt,
  inRange,
  inLevel,
  flow,
  showHandle = true,
}: {
  port: Port
  ligada: boolean
  falta: boolean
  /** Tensão efetiva da saída, ex. "5 V" no trimmer do DC-DC. */
  volt?: string
  /** true quando a saída é uma faixa (bateria/BMS), não um valor fixo. */
  range?: boolean
  /** Tensão que chega nesta porta de entrada, vinda da fonte. */
  inVolt?: string
  /** true quando a tensão que chega é uma faixa. */
  inRange?: boolean
  /** 'bad' se não cabe na entrada; 'warn' se a fonte pode sair da faixa. */
  inLevel?: 'bad' | 'warn' | null
  /** Visao de potencia: corrente que passa pela porta. Substitui o selo entrada/saida. */
  flow?: PortPower | null
  /**
   * false no modo condutores quando esta porta abre em pinos/instâncias
   * abaixo: o quadradinho da porta pareceria uma ligação em si, enquanto as
   * ligações de verdade chegam nas bolinhas dos condutores logo abaixo.
   */
  showHandle?: boolean
}) {
  const papeis = rolesOf(port)
  const recebe = papeis.includes('in')
  const envia = papeis.includes('out')
  const papel = roleOf(port)
  // Nome igual ao tipo (ex. "UART" / "UART", "I²C" / "I2C"): mostra só o colorido, centralizado.
  const norm = (t: string) => t.replace(/²/g, '2').toLowerCase()
  const dupe = port.kind !== 'power' && norm(port.label ?? port.id) === norm(port.protocol ?? '')

  return (
    <div
      className={`prow prow--${papel}${dupe ? ' prow--solo' : ''}${ligada ? ' prow--on' : ''}${falta ? ' prow--missing' : ''}${incerta(port) ? ' prow--unknown' : ''}`}
      title={falta ? 'obrigatória e ainda não ligada' : undefined}
    >
      {recebe && showHandle ? (
        <Handle
          id={handleId('in', port.id)}
          type="target"
          position={Position.Left}
          className={`mecha-handle mecha-handle--${port.kind}${incerta(port) ? ' mecha-handle--unknown' : ''}`}
        />
      ) : null}

      {recebe && inVolt ? (
        <span
          className={`prow__volt prow__volt--in${inRange ? ' prow__volt--range' : ''}${inLevel ? ` prow__volt--${inLevel}` : ''}`}
          title={
            inLevel === 'bad'
              ? 'tensão incompatível: não cabe na faixa que esta entrada aceita'
              : inLevel === 'warn'
                ? 'atenção: a fonte pode sair da faixa que esta entrada aceita'
                : inRange
                  ? 'tensão que chega pela entrada — faixa'
                  : 'tensão que chega pela entrada'
          }
        >
          {inVolt}
        </span>
      ) : null}
      {dupe ? null : <span className="prow__name">{port.label ?? port.id}</span>}
      {volt ? (
        <span
          className={`prow__volt${range ? ' prow__volt--range' : ''}`}
          title={range ? 'faixa de tensão na saída (não é um valor fixo)' : 'tensão na saída'}
        >
          {volt}
        </span>
      ) : null}
      {flow && !falta ? (
        <>
          {flow.in ? <FlowBullet flow={flow.in} dir="in" /> : null}
          {flow.out ? <FlowBullet flow={flow.out} dir="out" /> : null}
        </>
      ) : null}
      <span className={`prow__kind${flow && !falta && (flow.in || flow.out) ? ' prow__kind--hidden' : ''}`}>
        {falta
          ? 'falta ligar'
          : port.kind === 'power'
            ? port.dir === 'source'
              ? 'saída'
              : port.dir === 'bidir'
                ? 'comum'
                : 'entrada'
            : port.protocol}
      </span>

      {envia && showHandle ? (
        <Handle
          id={handleId('out', port.id)}
          type="source"
          position={Position.Right}
          className={`mecha-handle mecha-handle--${port.kind}${incerta(port) ? ' mecha-handle--unknown' : ''}`}
        />
      ) : null}
    </div>
  )
}

export default function ComponentNode({ id, data, selected }: NodeProps<ComponentFlowNode>) {
  const {
    component,
    level,
    issues,
    arrangement,
    connected,
    incoming,
    portInstances,
    connecting,
    isOrigin,
    multiSelected,
    expanded,
    power,
    idAsTitle,
    node,
  } = data
  const color = power ? POWER_ROLE_COLOR[power.role] : CATEGORY_COLOR[component.category]
  const name = nodeLabel(node, component)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const startEdit = () => {
    setDraft(name)
    setEditing(true)
  }
  const save = () => {
    const v = draft.trim()
    if (v) data.onRename(id, v)
    setEditing(false)
  }
  // Mesmo lugar onde o nome aparece: título (id) ou linha de baixo (tipo).
  const nameField = (cls: string) =>
    editing ? (
      <div className="node__rename nodrag nowheel">
        <input
          className="node__rename-input"
          value={draft}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <div className="node__rename-actions">
          <button type="button" onClick={save} disabled={!draft.trim()}>
            salvar
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            cancelar
          </button>
        </div>
      </div>
    ) : (
      <span className={cls}>{name}</span>
    )
  const ligadas = new Set(connected)
  const faltando = new Set(missingRequired(component, ligadas).flat().map((p) => p.id))

  // Na selecao em bloco o card age como um so: nada de abrir portas nem acoes.
  const single = selected && !multiSelected

  // Fechado, o bloco mostra so as portas em uso -- e o diagrama fica limpo.
  // Selecionado sozinho, mostra todas, para escolher a proxima ligacao.
  // Na visao de potencia so as portas que carregam energia (inclui o VBUS do USB).
  const relevantes = power
    ? component.ports.filter((p) => p.kind === 'power' || p.vbus)
    : component.ports
  const visiveis = single
    ? relevantes
    : relevantes.filter((p) => ligadas.has(p.id) || p.required)
  const ocultas = relevantes.length - visiveis.length

  const classes = [
    'node',
    component.external ? 'node--external' : '',
    power ? `node--pw node--pw-${power.role}` : '',
    power && (node.off || (power.role !== 'active' && !power.energized)) ? 'node--pw-off' : '',
    selected ? 'node--selected' : '',
    level ? `node--${level}` : '',
    connecting && !isOrigin ? 'node--target' : '',
    isOrigin ? 'node--origin' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} style={{ ['--cat' as string]: color }}>
      {level && issues.length > 0 ? <NodeIssueBadge level={level} issues={issues} /> : null}
      {single && !connecting ? (
        <div className="node__actions nodrag">
          <button
            type="button"
            className="node__connect"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              data.onStartConnect(id)
            }}
          >
            conectar a…
          </button>
          {connected.length > 0 ? (
            <button
              type="button"
              className="node__connect node__connect--danger"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                data.onStartDisconnect(id)
              }}
            >
              remover conexão
            </button>
          ) : null}
        </div>
      ) : null}

      {isOrigin ? (
        <button
          type="button"
          className="node__connect node__connect--active nodrag"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            data.onCancelConnect()
          }}
        >
          escolha o destino · cancelar
        </button>
      ) : null}

      <div className="node__head">
        {!editing ? (
          <button
            type="button"
            className="node__pencil nodrag"
            data-tip="Alterar nome do componente"
            aria-label="Renomear componente"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              startEdit()
            }}
          >
            ✎
          </button>
        ) : null}
        {(() => {
          const hierarchy = getTypeHierarchy(component.type)
          const mainType = hierarchy[0] // level-0
          const subTypes = hierarchy.slice(1).join(' · ') // level-1, level-2, ...
          const allTypes = hierarchy.join(' · ') // level-0, level-1, level-2, ...

          return (
            <>
              {idAsTitle ? (
                <>
                  <div className="node__title">{nameField("")}</div>
                  {allTypes && <div className="node__subtype">{allTypes}</div>}
                  {component.external ? (
                    <div className="node__external" title="alimentação prevista fora do projeto — não é uma peça do sistema">
                      fora do projeto
                    </div>
                  ) : null}
                  {arrangement ? <div className="node__meta">{arrangement}</div> : null}
                </>
              ) : (
                <>
                  <div className="node__title">{mainType}</div>
                  {subTypes && <div className="node__subtype">{subTypes}</div>}
                  {component.external ? (
                    <div className="node__external" title="alimentação prevista fora do projeto — não é uma peça do sistema">
                      fora do projeto
                    </div>
                  ) : null}
                  <div className="node__meta">
                    {nameField("node__id")}
                    {arrangement ? ` · ${arrangement}` : null}
                  </div>
                </>
              )}
            </>
          )
        })()}
      </div>

      {visiveis.length > 0 ? (
        <div className="node__ports">
          {visiveis.map((p) => {
            const ligada = ligadas.has(p.id)
            const papeis = rolesOf(p)
            const instances = expanded ? portInstances[p.id] : null
            const pins = !instances && expanded && ligada ? pinsOf(node, component, p) : null
            // Saída (ou porta comum) de energia: mostra a tensão desta instância.
            // Faixa -- bateria, BMS, trilho que segue VM -- ganha selo próprio:
            // não é valor fixo, e o card precisa dizer isso de relance.
            const pv = p.kind === 'power' && p.dir !== 'sink' ? effectiveVoltage(node, p) : null
            const pb = pv && !pv.unknown ? rangeBounds(pv) : null
            const volt = pv && pb ? formatRangeCompact(pv, 'V') : undefined
            const voltRange = Boolean(pb && pb.lo !== pb.hi)
            // Porta de entrada: o selo mostra o que chega, não o que a peça é.
            const inc = p.dir === 'sink' ? incoming[p.id] : undefined

            return (
              <div key={p.id}>
                <PortRow
                  port={p}
                  ligada={ligada}
                  falta={faltando.has(p.id)}
                  volt={volt}
                  range={voltRange}
                  inVolt={inc?.text}
                  inRange={inc?.range}
                  inLevel={inc?.level}
                  flow={power?.ports[p.id] ?? null}
                  showHandle={!expanded || (!instances && !pins)}
                />
                {instances ? (
                  <InstanceRows port={p} instances={instances} />
                ) : pins ? (
                  <div className="node__pins">
                    {pins.map((pin) => (
                      <PinRow
                        key={pin.id}
                        port={p}
                        pin={pin}
                        recebe={papeis.includes('in')}
                        envia={papeis.includes('out')}
                        papel={roleOf(p)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {ocultas > 0 ? (
        <div className="node__more">
          +{ocultas} {ocultas === 1 ? 'porta livre' : 'portas livres'} · clique para ver
        </div>
      ) : null}

      {power ? <PowerFooter power={power} off={Boolean(node.off)} onToggle={() => data.onTogglePower(id)} /> : null}
    </div>
  )
}
