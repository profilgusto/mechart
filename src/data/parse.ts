/**
 * A library.json nao e JSON valido: tem comentarios `//` e dois objetos de
 * topo concatenados (o mapa de componentes e, depois de `// units`, o glossario
 * de unidades). O arquivo e a fonte curada a mao do projeto, entao a ferramenta
 * se adapta a ele em vez de reformata-lo.
 */

/** Remove linhas que sao apenas um comentario `//`, preservando a numeracao. */
function stripLineComments(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
}

/**
 * Separa documentos JSON concatenados percorrendo o texto e contando chaves
 * fora de string. Cada vez que a profundidade volta a zero, um documento fechou.
 */
export function splitJsonDocuments(text: string): string[] {
  const docs: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }

    if (c === '"') {
      inString = true
    } else if (c === '{' || c === '[') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}' || c === ']') {
      depth--
      if (depth === 0 && start >= 0) {
        docs.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }

  return docs
}

export type ParsedSource = {
  components: Record<string, Record<string, unknown>>
  units: Record<string, string>
}

/** Le a library.json crua e devolve os dois documentos ja tipados. */
export function parseLibraryFile(raw: string): ParsedSource {
  const docs = splitJsonDocuments(stripLineComments(raw))

  if (docs.length === 0) {
    throw new Error('library.json: nenhum objeto JSON encontrado')
  }

  const components = JSON.parse(docs[0]) as Record<string, Record<string, unknown>>
  const units = docs.length > 1 ? (JSON.parse(docs[1]) as Record<string, string>) : {}

  return { components, units }
}
