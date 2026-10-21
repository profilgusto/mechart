import type { ArchEdge, ArchNode } from '../model/graph'

/** Nome com que um projeto nasce, e o fallback quando o nome fica vazio. */
export const DEFAULT_PROJECT_NAME = 'Novo Projeto'

/** Conteudo de um projeto mechart: nome, blocos e ligacoes. */
export type ProjectFile = {
  name: string
  nodes: ArchNode[]
  edges: ArchEdge[]
  /** Mensagens do painel de analise que o usuario optou por ignorar. */
  ignoredIssues?: string[]
}

export type ParseResult =
  | { ok: true; project: ProjectFile }
  | { ok: false; error: string }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Valida e normaliza um bloco. Devolve a mensagem de erro, ou o no limpo. */
function asNode(raw: unknown, i: number): ArchNode | string {
  if (!raw || typeof raw !== 'object') return `bloco ${i}: não é um objeto`
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return `bloco ${i}: falta "id"`
  if (typeof o.componentId !== 'string' || !o.componentId) {
    return `bloco ${o.id}: falta "componentId"`
  }
  const pos = o.position as Record<string, unknown> | undefined
  if (!pos || !isNum(pos.x) || !isNum(pos.y)) {
    return `bloco ${o.id}: "position" precisa de x e y numéricos`
  }

  const node: ArchNode = {
    id: o.id,
    componentId: o.componentId,
    position: { x: pos.x, y: pos.y },
  }
  if (typeof o.label === 'string') node.label = o.label
  if (isNum(o.series)) node.series = o.series
  if (isNum(o.parallel)) node.parallel = o.parallel
  if (isNum(o.setVoltage)) node.setVoltage = o.setVoltage
  if (isNum(o.setCurrent)) node.setCurrent = o.setCurrent
  if (o.off === true) node.off = true
  return node
}

/** Valida e normaliza uma ligacao. Devolve a mensagem de erro, ou a aresta. */
function asEdge(raw: unknown, i: number): ArchEdge | string {
  if (!raw || typeof raw !== 'object') return `conexão ${i}: não é um objeto`
  const o = raw as Record<string, unknown>
  const str = (k: string) => typeof o[k] === 'string' && (o[k] as string).length > 0
  if (!str('id')) return `conexão ${i}: falta "id"`
  if (!str('source')) return `conexão ${o.id}: falta "source"`
  if (!str('sourcePort')) return `conexão ${o.id}: falta "sourcePort"`
  if (!str('target')) return `conexão ${o.id}: falta "target"`
  if (!str('targetPort')) return `conexão ${o.id}: falta "targetPort"`
  return {
    id: o.id as string,
    source: o.source as string,
    sourcePort: o.sourcePort as string,
    target: o.target as string,
    targetPort: o.targetPort as string,
  }
}

/**
 * Le um arquivo de projeto baixado do mechart. Recusa qualquer coisa que nao
 * tenha o formato { nodes, edges } -- assim um JSON qualquer nao entra no quadro
 * silenciosamente. O campo `name` e opcional: sem ele, vale o nome padrao.
 */
export function parseProject(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'JSON do mechart deve ser um objeto com "nodes" e "edges".' }
  }
  const o = data as Record<string, unknown>
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) {
    return { ok: false, error: 'JSON do mechart precisa das listas "nodes" e "edges".' }
  }

  const nodes: ArchNode[] = []
  for (let i = 0; i < o.nodes.length; i++) {
    const r = asNode(o.nodes[i], i)
    if (typeof r === 'string') return { ok: false, error: r }
    nodes.push(r)
  }

  const edges: ArchEdge[] = []
  for (let i = 0; i < o.edges.length; i++) {
    const r = asEdge(o.edges[i], i)
    if (typeof r === 'string') return { ok: false, error: r }
    edges.push(r)
  }

  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : DEFAULT_PROJECT_NAME

  const project: ProjectFile = { name, nodes, edges }
  if (Array.isArray(o.ignoredIssues)) {
    const ignored = o.ignoredIssues.filter((k): k is string => typeof k === 'string')
    if (ignored.length > 0) project.ignoredIssues = ignored
  }

  return { ok: true, project }
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project, null, 2)
}

/** Chave do projeto em edicao guardado no navegador. */
const STORAGE_KEY = 'mechart:project'

/**
 * Le o projeto que ficou salvo neste navegador. Devolve null quando nao ha
 * nada, ou quando o conteudo guardado nao e um projeto valido (nesse caso a
 * entrada ruim e descartada).
 */
export function readStoredProject(): ProjectFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = parseProject(raw)
    if (parsed.ok) return parsed.project
    localStorage.removeItem(STORAGE_KEY)
    return null
  } catch {
    // modo privado: sem persistencia local
    return null
  }
}

/** Grava o projeto no navegador. Devolve false se o armazenamento recusou. */
export function writeStoredProject(project: ProjectFile): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project))
    return true
  } catch {
    // cota estourada ou modo privado: segue sem a copia local
    return false
  }
}

/** "Meu Robozão" -> "meu-robozao": minusculas, sem acentos nem especiais. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Timestamp local no estilo YYYY-MM-DD_HH-MM. */
export function fileStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`
}

/** Nome do arquivo baixado: mechart_<slug>_<YYYY-MM-DD_HH-MM>.json */
export function projectFileName(name: string, date: Date = new Date()): string {
  return `mechart_${slugify(name) || 'projeto'}_${fileStamp(date)}.json`
}
