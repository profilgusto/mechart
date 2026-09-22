import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { Component, Pin, Port } from '../model/types'
import { CATEGORY_COLOR } from '../data/normalize'
import { handleId, rolesOf, roleOf, type ArchNode } from '../model/graph'
import { pinsOf } from '../model/pins'
import { getTypeHierarchy } from '../model/component-type'

export type ComponentNodeData = {
  component: Component
  label: string
  level: 'error' | 'warning' | 'unverifiable' | null
  /** "3S2P · 6 células", quando o bloco representa um pack. */
  arrangement: string | null
  /** Ids das portas que ja tem alguma ligacao. */
  connected: string[]
  connecting: boolean
  isOrigin: boolean
  /** Mais de um bloco selecionado: selecao em bloco, nao edicao de um so. */
  multiSelected: boolean
  /** Modo expandido: as portas ligadas abrem nos seus condutores. */
  expanded: boolean
  node: ArchNode
  onStartConnect: (nodeId: string) => void
  onCancelConnect: () => void
  onStartDisconnect: (nodeId: string) => void
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
          className="karu-handle karu-handle--pin"
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
          className="karu-handle karu-handle--pin"
        />
      ) : null}
    </div>
  )
}

function PortRow({ port, ligada }: { port: Port; ligada: boolean }) {
  const falta = Boolean(port.required) && !ligada
  const papeis = rolesOf(port)
  const recebe = papeis.includes('in')
  const envia = papeis.includes('out')
  const papel = roleOf(port)

  return (
    <div
      className={`prow prow--${papel}${ligada ? ' prow--on' : ''}${falta ? ' prow--missing' : ''}${incerta(port) ? ' prow--unknown' : ''}`}
      title={falta ? 'obrigatória e ainda não ligada' : undefined}
    >
      {recebe ? (
        <Handle
          id={handleId('in', port.id)}
          type="target"
          position={Position.Left}
          className={`karu-handle karu-handle--${port.kind}${incerta(port) ? ' karu-handle--unknown' : ''}`}
        />
      ) : null}

      <span className="prow__name">{port.label ?? port.id}</span>
      <span className="prow__kind">
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

      {envia ? (
        <Handle
          id={handleId('out', port.id)}
          type="source"
          position={Position.Right}
          className={`karu-handle karu-handle--${port.kind}${incerta(port) ? ' karu-handle--unknown' : ''}`}
        />
      ) : null}
    </div>
  )
}

export default function ComponentNode({ id, data, selected }: NodeProps<ComponentFlowNode>) {
  const { component, level, arrangement, connected, connecting, isOrigin, multiSelected, expanded, node } =
    data
  const color = CATEGORY_COLOR[component.category]
  const ligadas = new Set(connected)

  // Na selecao em bloco o card age como um so: nada de abrir portas nem acoes.
  const single = selected && !multiSelected

  // Fechado, o bloco mostra so as portas em uso -- e o diagrama fica limpo.
  // Selecionado sozinho, mostra todas, para escolher a proxima ligacao.
  const visiveis = single
    ? component.ports
    : component.ports.filter((p) => ligadas.has(p.id) || p.required)
  const ocultas = component.ports.length - visiveis.length

  const classes = [
    'node',
    selected ? 'node--selected' : '',
    level ? `node--${level}` : '',
    connecting && !isOrigin ? 'node--target' : '',
    isOrigin ? 'node--origin' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} style={{ ['--cat' as string]: color }}>
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
        {(() => {
          const hierarchy = getTypeHierarchy(component.type)
          const mainType = hierarchy[0] // level-0
          const subTypes = hierarchy.slice(1).join(' · ') // level-1, level-2, ...
          
          return (
            <>
              <div className="node__title">{mainType}</div>
              {subTypes && <div className="node__subtype">{subTypes}</div>}
              <div className="node__meta">
                <span className="node__id">{component.id}</span>
                {arrangement ? ` · ${arrangement}` : ` · ${component.ports.length} portas`}
              </div>
            </>
          )
        })()}
      </div>

      {visiveis.length > 0 ? (
        <div className="node__ports">
          {visiveis.map((p) => {
            const ligada = ligadas.has(p.id)
            const papeis = rolesOf(p)
            const pins = expanded && ligada ? pinsOf(node, component, p) : null

            return (
              <div key={p.id}>
                <PortRow port={p} ligada={ligada} />
                {pins ? (
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
    </div>
  )
}
