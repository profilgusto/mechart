# karu-arch

Editor visual da arquitetura do karu-un: a biblioteca de componentes vira caixinhas,
você monta o diagrama de blocos ligando as portas, e as ligações são verificadas
contra as restrições reais de alimentação e comunicação de cada peça.

## Como rodar

Com Docker, a partir da raiz do projeto (um nível acima deste diretório):

```sh
docker compose up        # http://localhost:5180 · Ctrl+C para parar
docker compose up -d     # em segundo plano
docker compose down      # para
docker compose build     # reconstrói depois de mexer no package.json
```

Ou direto no Mac, se preferir:

```sh
npm install
npm run dev              # http://localhost:5180
```

Os dois caminhos leem e escrevem os mesmos arquivos, então dá para alternar
entre eles à vontade — só não rode os dois ao mesmo tempo, porque disputam a
porta 5180.

> **Ao criar um arquivo `.ts` novo, reinicie o container** (`docker compose restart
> karu-arch`). O watcher do Vite sobre bind mount do macOS acompanha edições em
> arquivos existentes, mas pode não notar arquivos criados depois que o servidor
> subiu — e aí ele continua servindo a versão antiga em silêncio, sem erro nenhum.

## Onde ficam os dados

Nada de valor mora dentro do container. Os três arquivos ficam no Mac e são
montados para dentro dele; `docker compose down` não perde nada. O
`components.json` entra montado como **somente leitura** — nem um bug consegue
escrever nele.

| Arquivo | Papel |
|---|---|
| `../components.json` | Ficha de datasheet. **Somente leitura** — o app nunca escreve nele. |
| `../arquitetura/ports.json` | Portas de cada componente (energia e dados), escritas à mão. |
| `../arquitetura/diagrama.json` | O diagrama. Salvo automaticamente enquanto você edita. |

O `components.json` não é JSON válido — tem comentários `//` e dois objetos de topo
concatenados (componentes e, depois de `// units`, o glossário de unidades).
`src/data/parse.ts` lida com isso; o arquivo continua no formato que você escreveu.

## ports.json

Cada porta carrega um campo `src` apontando para o caminho no `components.json`
de onde o valor saiu. Quando o dado não é publicado, a porta recebe `null` e um
`note` explicando o que falta — o app mostra **"a confirmar"** e a validação
responde **"não verificável"**, nunca "ok". É a regra do projeto ("só entram
valores confirmados") levada até o diagrama.

Dois ajustes são declarados em `instance`:

- `pack` — o bloco representa unidades arranjáveis. O `components.json` descreve
  **uma** célula 18650; o pack real se descreve com *Em série (S)* e *Em paralelo
  (P)*. Um 3S2P é `series: 3, parallel: 2` — seis células.

  A distinção importa: **série multiplica a tensão, paralelo não.** O paralelo
  multiplica capacidade, energia e a corrente que o pack entrega ou aceita
  carregando. O inspetor soma tudo e mostra o resultado.

  Os números de uma unidade ficam em `instance.unit`, com o campo de origem
  anotado — a capacidade usa `capacity.nominal-at-25c-typical`, porque é o que a
  nota do `components.json` manda adotar como figura de projeto.
- `adjustable` — a saída é regulada na montagem (o trimmer do MP1584EN). Declare a
  tensão em *Saída ajustada* para que as cargas sejam verificadas contra ela.

## Lendo o diagrama

Cada bloco lista suas portas, uma por linha, com o conector na borda — a linha
de ligação chega visivelmente na porta nomeada, então dá para ler direto do
diagrama qual fio vai em qual pino:

```
battery-charger                    bms
  BAT / GND   SAÍDA ●────────● P+ / P- (porta comum)   COMUM
```

- **Fechado**, o bloco mostra só as portas em uso e as obrigatórias pendentes.
- **Selecionado**, mostra todas, para você escolher a próxima ligação.
- Porta obrigatória ainda solta aparece em vermelho, marcada **FALTA LIGAR**.

### Dois modos

O seletor na barra alterna a visualização; a escolha fica lembrada no navegador.

- **blocos** — uma linha por ligação, bom para ler a arquitetura.
- **condutores** — cada ligação abre nos fios que ela representa, e cada fio
  chega no seu pino. É a vista de bancada.

```
blocos                          condutores
                                  -   ──neg ──▶  B-
pack 3S2P ──▶ bms                 B1  ──tap1──▶  B1
                                  B2  ──tap2──▶  B2
                                  +   ──pos ──▶  B+
```

Os pinos vêm de `pins` em `ports.json`, e cada um carrega um `signal` — o nome
lógico que casa as duas pontas. Iguais se ligam (`pos`↔`pos`, `sda`↔`sda`) e
`tx` cruza com `rx`, como tem de ser.

**Os taps de balanceamento são derivados do arranjo**, não escritos à mão: um
pack `series: 3` expõe `B1` e `B2` entre o `−` e o `+`; a mesma célula em `1S`
não expõe nenhum. Trocar o S no inspetor muda os condutores no diagrama.

46 das 62 portas têm pinagem declarada. As 16 restantes — USB, headers GPIO
genéricos, wireless, HDMI — não publicam pinagem útil, então continuam como uma
linha só mesmo no modo condutores. Não se inventa pinagem.

### Cores das portas

O papel da porta — o que interessa na hora de ligar — é a cor:

| Papel | Cor | Traço |
|---|---|---|
| Entrada (recebe) | teal | à esquerda, onde fica o conector |
| Saída (fornece) | laranja | à direita |
| Bidirecional (porta comum) | violeta | nos dois lados |

Duas leituras redundantes de propósito: quem não distingue as cores lê a posição
do traço e a palavra à direita. A **forma** do conector diz outra coisa: quadrado
é energia, círculo é dados. E o anel **amarelo** marca o que ainda falta
confirmar no datasheet.

A legenda no rodapé traz os dois grupos — *portas* (os papéis) e *ligações* (os
protocolos das linhas).

Quais portas são obrigatórias está declarado em `ports.json` (`"required": true`):
a alimentação principal de cada peça, mais o `STBY` do TB6612FNG, que precisa
estar alto para as saídas saírem da alta impedância.

## Como ligar dois blocos

Clique no bloco de origem; aparece um **“conectar a…”** discreto logo acima dele.
Clique nele e depois no bloco de destino. `Esc` ou um clique no vazio cancela.

A partir daí o app resolve sozinho, olhando as portas dos dois lados:

- **uma única forma possível** → liga na hora, escolhendo o par de portas certo;
- **várias formas** (o sensor de CO2 fala UART *ou* I²C pelos mesmos pinos) →
  abre um modal com as opções, cada uma com tensão, corrente e o caminho
  `origem.porta → destino.porta`;
- **nenhuma forma** → a barra explica por quê (sem protocolo em comum, portas já
  no limite, ou já ligados).

Não se arrasta mais de um conector a outro. Os quadradinhos nas bordas viraram
apenas marcadores de porta — cinza para valor confirmado, amarelo para o que
ainda falta confirmar.

O motor de pareamento considera os dois sentidos, então não importa qual bloco
você clicou primeiro. Ele também descarta sozinho as combinações que seriam
sempre erradas: faixas de tensão que não se cruzam (a saída da ponte H no 3V3 do
ESP32) e portas que só fazem sentido num ponto da topologia (o `only` do
`B+/B-` do BMS). Por isso ligar o carregador ao BMS dá **uma** opção, a certa.

## O que é verificado

| Regra | O que faz |
|---|---|
| Protocolo | Bloqueia a ligação no ato quando os protocolos ou o sentido não batem. Avisa sobre níveis lógicos diferentes. |
| Tensão | Sem interseção entre o que a fonte entrega e o que a entrada aceita = erro. Interseção parcial = atenção. |
| Portas | Respeita quantas ligações cada porta aceita, e as portas mutuamente exclusivas (o pino R/T do sensor de CO2 escolhe UART **ou** I²C). |
| Corrente | Soma o consumo pendurado em cada saída e compara com o que ela entrega. Carga sem consumo confirmado deixa a soma explicitamente incompleta. |
| Topologia | Portas com `only` só aceitam os componentes declarados. O `B+/B-` do BMS é para as células: ligar o carregador ali passa por fora dos MOSFETs de proteção. |
| Falta ligar | Portas `required` que ninguém ligou ainda — a resposta a "o que falta para isto funcionar". |
| Condutores | Pinos de **energia** que ficaram sem par ao expandir a ligação. Pega o pack menor (ou maior) do que o BMS espera: um 1S numa placa 3S deixa `B1` e `B2` sem alimentar, e sem eles não há balanceamento. Pinos de dados soltos não entram — uma porta unidirecional deixa o TX do host sobrando o tempo todo, e isso é normal. |

## Fora de escopo

Geometria e dimensões (vivem no CAD), roteamento físico de cabos, netlist KiCad.
