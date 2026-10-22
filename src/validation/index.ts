import type { Issue, Library } from '../model/types'
import type { ArchEdge, ArchNode } from '../model/graph'
import { checkVoltage } from './voltage'
import { checkProtocol } from './protocol'
import { checkPortCount } from './ports'
import { checkBudget } from './budget'
import { checkTopology } from './topology'
import { checkMissing } from './missing'
import { checkPins } from './pins'
import { checkAddresses } from './address'
import { checkPinout } from './pinout'

const ORDER = { error: 0, warning: 1, unverifiable: 2 }

export function validate(lib: Library, nodes: ArchNode[], edges: ArchEdge[]): Issue[] {
  return [
    ...checkProtocol(lib, nodes, edges),
    ...checkVoltage(lib, nodes, edges),
    ...checkPortCount(lib, nodes, edges),
    ...checkTopology(lib, nodes, edges),
    ...checkMissing(lib, nodes, edges),
    ...checkPins(lib, nodes, edges),
    ...checkAddresses(lib, nodes, edges),
    ...checkPinout(lib, nodes, edges),
    ...checkBudget(lib, nodes, edges),
  ].sort((a, b) => ORDER[a.level] - ORDER[b.level])
}

export { portsCompatible } from './protocol'
