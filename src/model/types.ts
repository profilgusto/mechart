/** Um valor numerico da ficha (specs) de um componente, depois de normalizado. */
export type Range = {
  min?: number
  nom?: number
  max?: number
  /** Estados nomeados, ex. o orange-pi com {idle: 240, load: 440}. */
  states?: Record<string, number>
  /** true quando o campo existe mas o valor ainda nao foi confirmado (null no fonte). */
  unknown: boolean
  /** Nota do datasheet, quando houver. */
  note?: string
}

export type Category = 'sensor' | 'power' | 'compute' | 'actuation' | 'external' | 'outro'

export type PortKind = 'power' | 'data'
/** sink = consome energia; source = fornece. in/out/bidir para dados. */
export type PortDir = 'source' | 'sink' | 'in' | 'out' | 'bidir'

/**
 * Um condutor de uma porta. `signal` e o nome logico que permite casar o pino
 * de um lado com o do outro: dois `pos` se ligam, e `tx` cruza com `rx`.
 */
export type Pin = {
  /** Como o pino e serigrafado na placa: "B+", "Tx", "vermelho". */
  id: string
  signal: string
  note?: string
}

export type Port = {
  id: string
  label?: string
  kind: PortKind
  dir: PortDir
  /** Portas de energia: faixa de tensao aceita (sink) ou entregue (source). */
  v?: Range | null
  /** Portas de energia sink (ou USB device, ver `vbus`): consumo tipico em mA. */
  draw_mA?: number | null
  /** Portas de energia sink: pico ou corrente minima exigida da fonte, em mA. */
  peak_mA?: number | null
  /** Portas de energia source (ou USB host, ver `vbus`): corrente maxima entregue em mA. */
  supply_mA?: number | null
  /**
   * Portas USB: o cabo tambem carrega o 5 V. `host` fornece VBUS (`supply_mA`),
   * `device` consome dele (`draw_mA`); entra no orcamento como uma saida de energia.
   */
  vbus?: 'host' | 'device'
  /** Portas de dados: protocolo (uart, i2c, spi, usb, ethernet, can, pwm, gpio, analog...). */
  protocol?: string
  /** Portas de dados: nivel logico em volts. */
  level_v?: number | null
  /** Quantas ligacoes simultaneas esta porta aceita. */
  count: number
  /**
   * Sem esta ligacao o componente nao funciona -- tipicamente a alimentacao.
   * Aparece sempre no bloco, mesmo desligada, para nao ser esquecida.
   */
  required?: boolean
  /** Ids de portas do mesmo componente que nao podem ser usadas junto com esta. */
  exclusiveWith?: string[]
  /**
   * Ids ou tipos de componentes que esta porta espera do outro lado. Ligar qualquer
   * outra coisa gera aviso -- serve para portas que so fazem sentido num ponto
   * especifico da topologia, como o lado da bateria de um BMS.
   */
  only?: string[]
  /** O que explicar quando `only` e violado. */
  onlyNote?: string
  /**
   * Os condutores desta porta. Sem isto o modo expandido nao tem o que abrir --
   * e nao se inventa pinagem: o que o datasheet nao publica fica de fora.
   */
  pins?: Pin[]
  /**
   * Nomes das instâncias físicas que esta porta representa, na mesma ordem em
   * que as ligações forem feitas (ex. UART do orange-pi: ["UART0", "UART5", ...]).
   * Só faz sentido em portas ponto-a-ponto (`count` > 1, ex. protocol "uart")
   * onde cada ligação simultânea é um pino físico diferente -- ao contrário de
   * um barramento (I²C/SPI), onde várias ligações dividem os mesmos fios.
   */
  instances?: string[]
  /** Caminho nos specs do componente de onde o dado veio (rastreabilidade). */
  src?: string
  note?: string
}

/**
 * Numeros de UMA unidade, usados para somar um pack. Ficam aqui, e nao no
 * codigo, para que a escolha de qual campo dos specs usar continue
 * documentada e rastreavel.
 */
export type PackUnit = {
  capacity_mAh?: number
  capacity_src?: string
  weight_g?: number
  weight_src?: string
}

/** Ajustes de instancia que este componente admite no quadro. */
export type InstanceSpec = {
  /** Unidades identicas arranjaveis em serie e/ou paralelo (uma celula). */
  pack?: boolean
  /** Numeros de uma unidade, para somar o pack. */
  unit?: PackUnit
  /** Fonte cuja tensao de saida e regulada na montagem (o trimmer do MP1584EN). */
  adjustable?: boolean
  /** Fonte cuja tensao de saida e fixa, escolhida na compra (o NDUB22TA). */
  selectableOutput?: boolean
}

import type { ComponentType } from './component-type'

/** Um componente do catalogo (data/components/<id>.json), mais o que a ferramenta deriva. */
export type Component = {
  id: string
  description: string
  category: Category
  /** Tipo hierárquico do componente (string simples ou objeto com níveis) */
  type: ComponentType
  /** A ficha do arquivo do componente: type e description no topo, depois os specs. */
  raw: Record<string, unknown>
  ports: Port[]
  instance: InstanceSpec
  /** Fronteira do projeto: fonte externa, nao uma peca de catalogo. */
  external: boolean
}

export type Library = {
  components: Component[]
  byId: Record<string, Component>
  units: Record<string, string>
  /** Ids do catalogo que ainda nao tem portas declaradas. */
  missingPorts: string[]
}

export type IssueLevel = 'error' | 'warning' | 'unverifiable'

export type Issue = {
  level: IssueLevel
  /** Regra que gerou o aviso. */
  rule: 'voltage' | 'protocol' | 'port-count' | 'budget' | 'topology' | 'missing' | 'pins'
  message: string
  /** Nos e arestas a destacar no canvas. */
  nodeIds?: string[]
  edgeIds?: string[]
}
