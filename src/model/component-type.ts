/**
 * Sistema de tipos hierárquico para componentes.
 * 
 * Suporta dois formatos:
 * - String simples: "bms", "battery-cell", etc.
 * - Objeto hierárquico: { "level-0": "sensor", "level-1": "lidar", "level-2": "mechanical" }
 */

/** Tipo simples (string) */
export type ComponentTypeSimple = string

/** Tipo hierárquico (objeto com níveis) */
export type ComponentTypeHierarchical = {
  'level-0': string
  'level-1'?: string
  'level-2'?: string
  'level-3'?: string
  [key: `level-${number}`]: string | undefined
}

/** Tipo de componente (flexível: string ou hierárquico) */
export type ComponentType = ComponentTypeSimple | ComponentTypeHierarchical

/**
 * Extrai a hierarquia de tipos de um componente.
 * @returns Array com os níveis da hierarquia (sempre tem pelo menos 1 elemento)
 */
export function getTypeHierarchy(type: ComponentType): string[] {
  if (typeof type === 'string') {
    return [type]
  }
  
  const hierarchy: string[] = []
  let i = 0
  while (type[`level-${i}`]) {
    hierarchy.push(type[`level-${i}`]!)
    i++
  }
  
  return hierarchy.length > 0 ? hierarchy : ['unknown']
}

/**
 * Verifica se um componente corresponde a um caminho de tipos.
 * @param type Tipo do componente
 * @param path Caminho a verificar, ex: ['sensor', 'lidar']
 * @returns true se o componente corresponde ao caminho
 */
export function matchesTypePath(type: ComponentType, path: string[]): boolean {
  const hierarchy = getTypeHierarchy(type)
  return path.every((value, i) => hierarchy[i] === value)
}

/**
 * Obtém o tipo no nível especificado.
 * @param type Tipo do componente
 * @param level Nível desejado (0, 1, 2, ...)
 * @returns Tipo no nível ou undefined se não existir
 */
export function getTypeAtLevel(type: ComponentType, level: number): string | undefined {
  if (typeof type === 'string') {
    return level === 0 ? type : undefined
  }
  return type[`level-${level}`]
}

/**
 * Verifica se o tipo é hierárquico.
 */
export function isHierarchical(type: ComponentType): type is ComponentTypeHierarchical {
  return typeof type === 'object'
}

/**
 * Obtém a categoria principal (level-0).
 */
export function getMainCategory(type: ComponentType): string {
  return getTypeHierarchy(type)[0]
}

/**
 * Formata o tipo para exibição.
 * @param type Tipo do componente
 * @param separator Separador entre níveis (padrão: ' → ')
 * @returns String formatada, ex: "sensor → lidar → mechanical"
 */
export function formatType(type: ComponentType, separator: string = ' → '): string {
  return getTypeHierarchy(type).join(separator)
}

/**
 * Agrupa componentes por nível de tipo.
 * @param components Array de componentes com seus tipos
 * @param level Nível para agrupar (0, 1, 2, ...)
 * @returns Mapa de tipo → componentes
 */
export function groupByTypeLevel<T>(
  components: Array<{ id: string; type: ComponentType; data: T }>,
  level: number
): Map<string, Array<{ id: string; type: ComponentType; data: T }>> {
  const groups = new Map<string, Array<{ id: string; type: ComponentType; data: T }>>()
  
  for (const comp of components) {
    const typeAtLevel = getTypeAtLevel(comp.type, level) || 'other'
    
    if (!groups.has(typeAtLevel)) {
      groups.set(typeAtLevel, [])
    }
    groups.get(typeAtLevel)!.push(comp)
  }
  
  return groups
}

/**
 * Filtra componentes por caminho de tipo.
 * @param components Array de componentes com seus tipos
 * @param path Caminho a filtrar, ex: ['sensor', 'light']
 * @returns Componentes que correspondem ao caminho
 */
export function filterByTypePath<T>(
  components: Array<{ id: string; type: ComponentType; data: T }>,
  path: string[]
): Array<{ id: string; type: ComponentType; data: T }> {
  return components.filter(comp => matchesTypePath(comp.type, path))
}
