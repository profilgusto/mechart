// Confere o catalogo (data/components/*.json) sem subir o app. Sai com 1 se
// houver qualquer problema -- serve de rede de seguranca local e, depois, de CI.
import { readFileSync, readdirSync } from 'node:fs'
import { parseComponentFile } from '../src/data/catalog.ts'

const dir = new URL('../data/components/', import.meta.url)
const problems = []
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
const catalog = new Map()

for (const f of files) {
  try {
    const c = parseComponentFile(readFileSync(new URL(f, dir), 'utf8'), f)
    if (f !== `${c.id}.json`) problems.push(`${f}: o nome do arquivo deve ser "${c.id}.json"`)
    catalog.set(c.id, c)
  } catch (e) {
    problems.push(e.message)
  }
}

// `only` aceita ids de componente ou tipos em qualquer nivel da hierarquia
// (ver src/validation/topology.ts).
const typeNames = new Set()
for (const c of catalog.values()) {
  const t = c.type
  if (typeof t === 'string') typeNames.add(t)
  else if (t) Object.values(t).forEach((v) => typeof v === 'string' && typeNames.add(v))
}

for (const [id, c] of catalog) {
  const pinIds = new Set()
  const caps = new Set()
  for (const pin of c.pinout?.pins ?? []) {
    if (pinIds.has(pin.id)) problems.push(`${id}: pino "${pin.id}" repetido no pinout`)
    pinIds.add(pin.id)
    pin.caps.forEach((cap) => caps.add(cap))
    if (pin.level && !['caution', 'reserved'].includes(pin.level)) {
      problems.push(`${id}.${pin.id}: level "${pin.level}" inválido (caution ou reserved)`)
    }
    if (pin.level && !pin.why) problems.push(`${id}.${pin.id}: falta "why" explicando o level`)
  }
  for (const p of c.ports) {
    if (!p.uses) continue
    if (!c.pinout) problems.push(`${id}.${p.id}: "uses" sem "pinout" no componente`)
    else if (!caps.has(p.uses.needs)) {
      problems.push(`${id}.${p.id}: uses.needs "${p.uses.needs}" não existe em nenhum pino do pinout`)
    }
  }
  const ids = new Set()
  for (const p of c.ports) {
    if (ids.has(p.id)) problems.push(`${id}: porta "${p.id}" repetida`)
    ids.add(p.id)
  }
  for (const p of c.ports) {
    if (!p.src) problems.push(`${id}.${p.id}: falta "src" (de onde veio o dado)`)
    for (const other of p.exclusiveWith ?? []) {
      if (!ids.has(other)) problems.push(`${id}.${p.id}: exclusiveWith "${other}" não existe`)
    }
    for (const a of (p.addresses ?? []).flat()) {
      if (!/^0x[0-9a-f]{1,2}$/i.test(a) || parseInt(a, 16) > 0x7f) {
        problems.push(`${id}.${p.id}: endereço "${a}" inválido (esperado 0x00–0x7F)`)
      }
    }
    for (const target of p.only ?? []) {
      if (!catalog.has(target) && !typeNames.has(target)) {
        problems.push(`${id}.${p.id}: only "${target}" não é um componente nem um tipo`)
      }
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`)
  console.error(`\n${problems.length} problema(s) em ${files.length} arquivos.`)
  process.exit(1)
}
console.log(`✓ ${files.length} componentes conferidos`)
