import { useState, useMemo } from 'react'
import type { Category, Component } from '../model/types'
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../data/normalize'
import { formatType, getTypeHierarchy } from '../model/component-type'
import TypeFilter from './TypeFilter'

const ORDER: Category[] = ['power', 'compute', 'sensor', 'actuation', 'outro']

export default function Library({
  components,
  selectedId,
  onSelect,
  onAdd,
}: {
  components: Component[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: (id: string) => void
}) {
  const [filteredComponents, setFilteredComponents] = useState<Component[]>(components)
  const [showTypeFilter, setShowTypeFilter] = useState(false)

  const displayComponents = showTypeFilter ? filteredComponents : components

  // Agrupa por categoria e ordena por tipo dentro de cada grupo
  const groups = useMemo(() => {
    return ORDER.map((cat) => {
      const items = displayComponents
        .filter((c) => c.category === cat)
        .sort((a, b) => {
          // Ordena por hierarquia de tipos
          const hierarchyA = getTypeHierarchy(a.type).join(' · ')
          const hierarchyB = getTypeHierarchy(b.type).join(' · ')
          return hierarchyA.localeCompare(hierarchyB)
        })
      
      return { cat, items }
    }).filter((g) => g.items.length > 0)
  }, [displayComponents])

  return (
    <nav className="panel">
      <div className="panel__header">
        <h1>Biblioteca</h1>
        <button
          type="button"
          className="panel__toggle-filter"
          onClick={() => setShowTypeFilter(!showTypeFilter)}
          title={showTypeFilter ? 'Ocultar filtro' : 'Mostrar filtro'}
        >
          {showTypeFilter ? '🔍−' : '🔍+'}
        </button>
      </div>
      <p className="subtitle">{displayComponents.length} componentes</p>

      {showTypeFilter && (
        <TypeFilter 
          components={components} 
          onFilterChange={setFilteredComponents}
        />
      )}

      {groups.map(({ cat, items }) => (
        <section key={cat}>
          <h2>{CATEGORY_LABEL[cat]}</h2>
          {items.map((c) => {
            const typeHierarchy = formatType(c.type, ' · ')
            
            return (
              <div
                key={c.id}
                className="chip"
                style={{ ['--cat' as string]: CATEGORY_COLOR[cat] }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/karu-component', c.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
              >
                <button
                  type="button"
                  className="chip__main"
                  aria-pressed={c.id === selectedId}
                  onClick={() => onSelect(c.id)}
                >
                  <span className="chip__id">{c.id}</span>
                  <span className="chip__type">{typeHierarchy}</span>
                </button>
                <button
                  type="button"
                  className="chip__add"
                  title={`Adicionar ${c.id} ao quadro`}
                  aria-label={`Adicionar ${c.id} ao quadro`}
                  onClick={() => onAdd(c.id)}
                >
                  +
                </button>
              </div>
            )
          })}
        </section>
      ))}
    </nav>
  )
}
