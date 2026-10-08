# mecha-arch

Editor visual da arquitetura de sistemas mecatrônicos: a biblioteca de componentes
vira caixinhas, você monta o diagrama de blocos ligando as portas, e as ligações
são verificadas contra as restrições reais de alimentação e comunicação de cada peça.

O projeto nasceu para o robô karu-un, mas a aplicação é **auto-contida e genérica**:
o catálogo (`data/library.json`) e as portas (`data/ports.json`) são apenas dados.
O exemplo do karu-un vem embutido e é o projeto aberto por padrão.

## Como rodar

A aplicação é auto-contida — rode os comandos **a partir desta pasta**.

Com Docker:

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
> mecha-arch`). O watcher do Vite sobre bind mount do macOS acompanha edições em
> arquivos existentes, mas pode não notar arquivos criados depois que o servidor
> subiu — e aí ele continua servindo a versão antiga em silêncio, sem erro nenhum.

## Onde ficam os dados

Os dados vivem dentro da aplicação, em `data/`, e são versionados junto com o
código. Nada de valor mora dentro do container; `docker compose down` não perde
nada. O `library.json` é lido pelo app mas nunca escrito por ele — nem um bug
consegue alterá-lo.

| Arquivo | Papel |
|---|---|
| `data/library.json` | Catálogo de componentes. **Lido, nunca escrito** pelo app. |
| `data/ports.json` | Portas de cada componente (energia e dados), escritas à mão. |
| `data/diagram.json` | O diagrama. Salvo automaticamente enquanto você edita. |

O `library.json` não é JSON válido — tem comentários `//` e dois objetos de topo
concatenados (componentes e, depois de `// units`, o glossário de unidades).
`src/data/parse.ts` lida com isso; o arquivo continua no formato que você escreveu.

## ports.json

Cada porta carrega um campo `src` apontando para o caminho no `library.json`
de onde o valor saiu. Quando o dado não é publicado, a porta recebe `null` e um
`note` explicando o que falta — o app mostra **"a confirmar"** e a validação
responde **"não verificável"**, nunca "ok". É a regra do projeto ("só entram
valores confirmados") levada até o diagrama.

Ajustes são declarados em `instance`:

- `pack` — o bloco representa unidades arranjáveis. O `library.json` descreve
  **uma** célula 18650; o pack real se descreve com *Em série (S)* e *Em paralelo
  (P)*. Um 3S2P é `series: 3, parallel: 2` — seis células.

  A distinção importa: **série multiplica a tensão, paralelo não.** O paralelo
  multiplica capacidade, energia e a corrente que o pack entrega ou aceita
  carregando. O inspetor soma tudo e mostra o resultado.

  Os números de uma unidade ficam em `instance.unit`, com o campo de origem
  anotado — a capacidade usa `capacity.nominal-at-25c-typical`, porque é o que a
  nota do `library.json` manda adotar como figura de projeto.
- `adjustable` — a saída é regulada na montagem (o trimmer do MP1584EN). Declare a
  tensão em *Saída ajustada* para que as cargas sejam verificadas contra ela.
- `selectableOutput` — a saída é fixa, escolhida na compra entre variantes (o
  NDUB22TA). Declare a versão em *Saída escolhida*.

A tensão declarada aparece no próprio card, na linha da porta de saída (ex. o
`out` do DC-DC com `5 V`), para se ler a tensão do trilho direto do diagrama.
Saídas que são **faixa** — o `P+/P-` da BMS, a descarga do pack — ganham um selo
com borda tracejada e gradiente, em vez do preenchimento sólido do valor fixo.

Do outro lado, cada porta de **entrada** ligada mostra, logo ao lado do conector,
a tensão que chega ali — calculada a partir da saída de quem a alimenta. O selo
de entrada é o espelho do de saída: junta a tensão aplicada pela fonte com o que
o destino recebe. O selo segue a mesma regra da validação de tensão: **vermelho**
quando a faixa que chega não cruza a que a entrada aceita (erro), **âmbar** quando
cruza mas pode sair dela (aviso).

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
| Falta ligar | Portas `required` que ninguém ligou ainda — a resposta a "o que falta para isto funcionar". Portas mutuamente exclusivas contam como **um grupo alternativo**: basta uma ligada (o Orange Pi aceita energia pelo USB-C **ou** pelos pinos 5 V do header). |
| Condutores | Pinos de **energia** que ficaram sem par ao expandir a ligação. Pega o pack menor (ou maior) do que o BMS espera: um 1S numa placa 3S deixa `B1` e `B2` sem alimentar, e sem eles não há balanceamento. Pinos de dados soltos não entram — uma porta unidirecional deixa o TX do host sobrando o tempo todo, e isso é normal. |

## Fora de escopo

Geometria e dimen