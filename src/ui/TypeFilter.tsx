import { useState, useMemo } from 'react'
import type { Component } from '../model/types'
import { filterByTypePath, groupByTypeLevel } from '../model/component-type'

export type TypeFilterProps = {
  components: Component[]
  onFilterChange: (filtered: Component[]) => void
}

export default function TypeFilter({ components, onFilterChange }: TypeFilterProps) {
  const [selectedPath, setSelectedPath] = useState<string[]>([])

  // Prepara dados para groupByTypeLevel
  const componentsWithType = useMemo(
    () => components.map(c => ({ id: c.id, type: c.type, data: c })),
    [components]
  )

  // Agrupa por level-0
  const level0Groups = useMemo(
    () => groupByTypeLevel(componentsWithType, 0),
    [componentsWithType]
  )

  // Agrupa por level-1 quando level-0 está selecionado
  const level1Groups = useMemo(() => {
    if (selectedPath.length === 0) return null
    const filtered = filterByTypePath(componentsWithType, [selectedPath[0]])
    return groupByTypeLevel(filtered, 1)
  }, [componentsWithType, selectedPath])

  // Agrupa por level-2 quando level-1 está selecionado
  const level2Groups = useMemo(() => {
    if (selectedPath.length < 2) return null
    const filtered = filterByTypePath(componentsWithType, selectedPath.slice(0, 2))
    return groupByTypeLevel(filtered, 2)
  }, [componentsWithType, selectedPath])

  // Aplica filtro quando o caminho muda
  useMemo(() => {
    if (selectedPath.length === 0) {
      onFilterChange(components)
    } else {
      const filtered = filterByTypePath(componentsWithType, selectedPath)
      onFilterChange(filtered.map(c => c.data))
    }
  }, [selectedPath, componentsWithType, components, onFilterChange])

  const handleLevel0Click = (type: string) => {
    if (selectedPath[0] === type) {
      // Deselect
      setSelectedPath([])
    } else {
      // Select level-0 only
      setSelectedPath([type])
    }
  }

  const handleLevel1Click = (type: string) => {
    if (selectedPath[1] === type) {
      // Go back to level-0 only
      setSelectedPath([selectedPath[0]])
    } else {
      // Select level-0 + level-1
      setSelectedPath([selectedPath[0], type])
    }
  }

  const handleLevel2Click = (type: string) => {
    if (selectedPath[2] === type) {
      // Go back to level-0 + level-1
      setSelectedPath([selectedPath[0], selectedPath[1]])
    } else {
      // Select full path
      setSelectedPath([selectedPath[0], selectedPath[1], type])
    }
  }

  const handleClear = () => {
    setSelectedPath([])
  }

  return (
    <div className="type-filter">
      <div className="type-filter__header">
        <h3>Filtro por tipo</h3>
        {selectedPath.length > 0 && (
          <button 
            type="button" 
            className="type-filter__clear"
            onClick={handleClear}
            title="Limpar filtro"
          >
            ✕
          </button>
        )}
      </div>

      {/* Breadcrumb do caminho selecionado */}
      {selectedPath.length > 0 && (
        <div className="type-filter__breadcrumb">
          {selectedPath.map((type, i) => (
            <span key={i}>
              {i > 0 && <span className="type-filter__separator"> → </span>}
              <button
                type="button"
                className="type-filter__breadcrumb-item"
                onClick={() => setSelectedPath(selectedPath.slice(0, i + 1))}
              >
                {type}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Level 0 - Categoria principal */}
      <div className="type-filter__level">
        <div className="type-filter__level-title">Categoria</div>
        <div className="type-filter__options">
          {Array.from(level0Groups.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([type, items]) => (
              <button
                key={type}
                type="button"
                className={`type-filter__option ${selectedPath[0] === type ? 'selected' : ''}`}
                onClick={() => handleLevel0Click(type)}
              >
                <span className="type-filter__option-label">{type}</span>
                <span className="type-filter__option-count">{items.length}</span>
              </button>
            ))}
        </div>
      </div>

      {/* Level 1 - Subcategoria */}
      {level1Groups && level1Groups.size > 0 && (
        <div className="type-filter__level">
          <div className="type-filter__level-title">Tipo</div>
          <div className="type-filter__options">
            {Array.from(level1Groups.entries())
              .filter(([type]) => type !== 'other')
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([type, items]) => (
                <button
                  key={type}
                  type="button"
                  className={`type-filter__option ${selectedPath[1] === type ? 'selected' : ''}`}
                  onClick={() => handleLevel1Click(type)}
                >
                  <span className="type-filter__option-label">{type}</span>
                  <span className="type-filter__option-count">{items.length}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Level 2 - Especificação */}
      {level2Groups && level2Groups.size > 0 && (
        <div className="type-filter__level">
          <div className="type-filter__level-title">Especificação</div>
          <div className="type-filter__options">
            {Array.from(level2Groups.entries())
              .filter(([type]) => type !== 'other')
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([type, items]) => (
                <button
                  key={type}
                  type="button"
                  className={`type-filter__option ${selectedPath[2] === type ? 'selected' : ''}`}
                  onClick={() => handleLevel2Click(type)}
                >
                  <span className="type-filter__option-label">{type}</span>
                  <span className="type-filter__option-count">{items.length}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Resumo */}
      <div className="type-filter__summary">
        {selectedPath.length === 0 
          ? `${components.length} componentes`
          : `${filterByTypePath(componentsWithType, selectedPath).length} componentes filtrados`
        }
      </div>
    </div>
  )
}
