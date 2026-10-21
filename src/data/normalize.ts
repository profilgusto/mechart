import type { Category, Range } from '../model/types'

/**
 * Os valores dos specs sao polimorficos. Uma tensao pode ser
 * `290`, `{min,nominal,max}`, `{idle,load}`, `{max}` ou `null` + `note`.
 * Tudo vira um Range, e `null` vira `unknown: true` -- nunca zero.
 */
export function toRange(value: unknown): Range {
  if (value === null || value === undefined) return { unknown: true }

  if (typeof value === 'number') return { nom: value, unknown: false }

  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    const num = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : undefined)

    const min = num('min')
    const nom = num('nominal') ?? num('nom')
    const max = num('max')
    const note = typeof o.note === 'string' ? o.note : undefined

    // Estados nomeados: qualquer chave numerica que nao seja min/nominal/max.
    const states: Record<string, number> = {}
    for (const [k, v] of Object.entries(o)) {
      if (['min', 'nominal', 'nom', 'max'].includes(k)) continue
      if (typeof v === 'number') states[k] = v
    }
    const hasStates = Object.keys(states).length > 0

    if (min === undefined && nom === undefined && max === undefined && !hasStates) {
      return { unknown: true, note }
    }

    return {
      min,
      nom,
      max,
      states: hasStates ? states : undefined,
      unknown: false,
      note,
    }
  }

  return { unknown: true }
}

/** O menor e o maior valor que um Range admite, para comparacao de faixas. */
export function rangeBounds(r: Range): { lo: number; hi: number } | null {
  if (r.unknown) return null
  const values = [r.min, r.nom, r.max, ...Object.values(r.states ?? {})].filter(
    (v): v is number => typeof v === 'number',
  )
  if (values.length === 0) return null
  return { lo: Math.min(...values), hi: Math.max(...values) }
}

/** Corta o lixo de ponto flutuante que aparece ao multiplicar (3 x 4.2). */
const n = (v: number): string => String(Number(v.toFixed(4)))

export function formatRange(r: Range, unit?: string): string {
  if (r.unknown) return 'a confirmar'
  const u = unit ? ` ${unit}` : ''

  if (r.states) {
    const parts = Object.entries(r.states).map(([k, v]) => `${k}: ${n(v)}${u}`)
    return parts.join(' · ')
  }
  if (r.min !== undefined && r.max !== undefined) {
    const nom = r.nom !== undefined ? ` (nom. ${n(r.nom)})` : ''
    return `${n(r.min)}–${n(r.max)}${u}${nom}`
  }
  if (r.nom !== undefined) return `${n(r.nom)}${u}`
  if (r.max !== undefined) return `máx. ${n(r.max)}${u}`
  if (r.min !== undefined) return `mín. ${n(r.min)}${u}`
  return 'a confirmar'
}

/**
 * Versao enxuta de `formatRange` para o selo de tensao no card: uma faixa vira
 * so os dois limites ("7,5–12,6 V"), sem o nominal -- o card precisa deixar
 * claro que e uma banda, nao um numero. O nominal continua no inspetor.
 */
export function formatRangeCompact(r: Range, unit?: string): string {
  if (r.unknown) return 'a confirmar'
  const u = unit ? ` ${unit}` : ''
  if (r.min !== undefined && r.max !== undefined && r.min !== r.max) {
    return `${n(r.min)}–${n(r.max)}${u}`
  }
  return formatRange(r, unit)
}

const CATEGORY_BY_ID: Record<string, Category> = {
  bms: 'power',
  'dc-dc-converter': 'power',
  'battery-charger': 'power',
  'battery-cell': 'power',
  'motor-driver': 'actuation',
  motor: 'actuation',
  esp32: 'compute',
  'orange-pi': 'compute',
  'external-source': 'external',
}

/** Fallback para arquivo de componente sem `category`: vem do prefixo do id. */
export function categoryOf(id: string): Category {
  if (id.startsWith('sensor-')) return 'sensor'
  return CATEGORY_BY_ID[id] ?? 'outro'
}

export const CATEGORY_LABEL: Record<Category, string> = {
  sensor: 'Sensores',
  power: 'Energia',
  compute: 'Computação',
  actuation: 'Atuação',
  external: 'Fontes externas',
  outro: 'Outros',
}

/** Paleta no espirito do diagrama de referencia (ROSI). */
export const CATEGORY_COLOR: Record<Category, string> = {
  sensor: '#3b6fd4',
  power: '#e0a127',
  compute: '#1f7a6a',
  actuation: '#b5562f',
  external: '#5c6b73',
  outro: '#6b7280',
}
