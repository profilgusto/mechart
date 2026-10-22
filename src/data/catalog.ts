import type { Category, Component, InstanceSpec, Pinout, Port } from '../model/types'
import type { ComponentType } from '../model/component-type'

// Modulo puro (sem imports de valor): o app e os scripts de `scripts/` leem o
// catalogo pelas mesmas funcoes, entao um arquivo valido para um e valido para o outro.

export const CATALOG_SCHEMA_VERSION = 1

/**
 * Um componente em disco: `data/components/<id>.json`. A ficha do datasheet
 * (`specs`) e as portas interpretadas (`ports`) vivem juntas, lado a lado.
 */
export type ComponentFile = {
  schemaVersion: number
  id: string
  description?: string
  type?: ComponentType
  category?: Category
  /**
   * Fronteira do projeto: uma fonte que nao e peca do sistema, mas alimenta o
   * quadro de fora (o USB-C do charger ligado numa fonte de bancada). Nao tem
   * `specs` e nunca entra no BOM.
   */
  external?: boolean
  instance?: InstanceSpec
  ports: Port[]
  /** Pinagem fisica (furos do header), para conferir quantos pinos o projeto pede. */
  pinout?: Pinout
  /** A ficha tecnica crua, sem `description` e `type` (que sobem para o topo). */
  specs?: Record<string, unknown>
}

const EXTERNAL_DESCRIPTION =
  'Alimentação fornecida de fora do projeto — não é uma peça do sistema.'

/** Le e confere o formato de um arquivo de componente. Lanca com o nome do arquivo. */
export function parseComponentFile(text: string, fileName: string): ComponentFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`${fileName}: JSON inválido (${(e as Error).message})`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${fileName}: deve ser um objeto`)
  }
  const o = data as Record<string, unknown>
  if (o.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new Error(
      `${fileName}: schemaVersion ${String(o.schemaVersion)} não suportado (esperado ${CATALOG_SCHEMA_VERSION})`,
    )
  }
  if (typeof o.id !== 'string' || !o.id) throw new Error(`${fileName}: falta "id"`)
  if (!Array.isArray(o.ports)) throw new Error(`${fileName}: "ports" deve ser uma lista`)
  return data as ComponentFile
}

/**
 * Monta o `Component` que o app usa. `raw` mantem a forma que o Inspector
 * sempre leu (type e description no topo, a ficha logo depois); `fallbackCategory`
 * cobre arquivos que nao declaram categoria.
 */
export function toComponent(
  file: ComponentFile,
  fallbackCategory: (id: string) => Category,
): Component {
  const external = file.external === true
  const description =
    typeof file.description === 'string'
      ? file.description
      : external
        ? EXTERNAL_DESCRIPTION
        : file.id
  const type: ComponentType = file.type ?? (external ? 'Fonte externa' : 'unknown')

  return {
    id: file.id,
    description,
    category: file.category ?? (external ? 'external' : fallbackCategory(file.id)),
    type,
    raw: { type, description, ...file.specs },
    ports: file.ports,
    pinout: file.pinout,
    instance: file.instance ?? {},
    external,
  }
}
