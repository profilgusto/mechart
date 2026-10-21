# mechart

Editor visual da arquitetura de sistemas mecatrônicos: a biblioteca de componentes
vira caixinhas, você monta o diagrama de blocos ligando as portas, e as ligações
são verificadas contra as restrições reais de alimentação e comunicação de cada peça.

O projeto nasceu para o robô karu-un, mas a aplicação é **auto-contida e genérica**:
o catálogo (`data/components/`, um arquivo por componente) é apenas dado.
O mechart abre por padrão num **projeto novo em branco**; o exemplo do karu-un
segue versionado em `data/diagram.json` como referência.

## Como rodar

A aplicação é auto-contida — rode os comandos **a partir desta pasta**.

### Desenvolvimento

```sh
npm install
npm run dev              # Vite em http://localhost:5180, com hot reload
npm run typecheck        # tsc --noEmit
npm run check:data       # confere os arquivos de data/components/
npm run build            # gera o site estático em dist/
npm run preview          # serve o dist/ localmente para conferir
```

### Produção (site estático)

`npm run build` gera um site **100% estático** em `dist/`. Não há servidor de
aplicação, endpoint de escrita nem banco de dados: os dados do catálogo entram no
bundle em tempo de build e o projeto do usuário vive no navegador. Qualquer host
estático serve a pasta — Netlify, GitHub Pages, S3/CloudFront, ou o nginx da
imagem Docker.

Com Docker, a imagem é **multi-stage**: o primeiro estágio roda o build, e o
segundo entrega `dist/` por um nginx **não-root** (imagem `nginx-unprivileged`),
com rootfs somente leitura, `no-new-privileges` e headers de segurança (CSP,
HSTS, `X-Frame-Options`, etc.) já configurados em `nginx.conf`:

```sh
docker compose -f docker-compose.prod.yml up -d --build   # http://localhost:5180
docker compose -f docker-compose.prod.yml down            # para
```

Para desenvolver, o `docker-compose.yml` padrão sobe o Vite com **hot reload**
(código montado do host, em `Dockerfile.dev`):

```sh
docker compose up -d --build   # http://localhost:5180
docker compose down            # para
```

> **Para publicar na internet**, ponha um TLS na frente (Caddy/Let's Encrypt ou
> um balanceador) e mantenha a porta do container restrita. O app é estático, mas
> o `Strict-Transport-Security` do nginx só faz efeito sobre HTTPS.

Não rode o Docker e o `npm run dev` ao mesmo tempo: ambos usam a porta 5180.

## Onde ficam os dados

Os dados vivem dentro da aplicação, em `data/`, e são versionados junto com o
código. No build eles são **embutidos no bundle** via `?raw` (ver
`src/data/load.ts`): o catálogo e o glossário de unidades viram parte do
JavaScript gerado, sem nenhuma requisição de rede. O catálogo é lido pelo app mas
nunca escrito por ele — nem um bug consegue alterá-lo.

| Arquivo | Papel |
|---|---|
| `data/components/<id>.json` | Um componente: ficha do datasheet (`specs`) e portas (`ports`) juntas. Embutido no build. **Lido, nunca escrito** pelo app. |
| `data/units.json` | Glossário de unidades da ficha técnica. Embutido no build. |
| `data/diagram.json` | Exemplo curado do karu-un (referência). Não é carregado automaticamente. |

O projeto **aberto no editor não vai para o servidor** — não existe servidor. Ele
é espelhado no **`localStorage` do navegador** (chave `mechart:project`), a cada
salvamento (com debounce). Ao abrir o mechart de novo, o app reabre essa cópia —
é o "onde você parou". Sem nada guardado no navegador, ele começa num **projeto
novo em branco**. "Novo projeto" e "Carregar projeto" (menu *Arquivo*) substituem
essa cópia; "Baixar projeto" é o que leva o projeto para fora do navegador, e
"Carregar projeto…" o traz de volta.

O projeto tem um **nome** (campo `name`), mostrado ao lado do menu *Arquivo* e
renomeável pelo lápis que aparece no hover. Ele viaja no JSON salvo e baixado; sem
o campo, vale "Novo Projeto". **Baixar projeto** grava o arquivo como
`mechart_<slug>_<YYYY-MM-DD_HH-MM>.json` — o nome em caixa-baixa, sem acento nem
caractere especial, espaços virando `-`, seguido do instante do download.

## Componentes (`data/components/`)

Cada componente é **um JSON puro**, com o mesmo nome do `id` (`ncr18650b.json`):

```json
{
  "schemaVersion": 1,
  "id": "ldrobot-d500",
  "description": "LDROBOT D500 Development Kit",
  "type": { "level-0": "sensor", "level-1": "lidar" },
  "category": "sensor",
  "instance": {},
  "ports": [ ... ],
  "specs": { ... }
}
```

- `specs` é a ficha do datasheet como foi transcrita (o Inspector a desenha como
  árvore, com as unidades de `data/units.json`).
- `ports` são as portas interpretadas, escritas à mão a partir dos `specs`. É o
  que a validação lê.
- `instance` (opcional) declara os ajustes de instância, descritos abaixo.
- Fonte externa (`"external": true`) não é peça do sistema: não tem `specs` e
  nunca entra no BOM.

**Para adicionar uma peça**, crie `data/components/<id>.json` e rode
`npm run check:data`, que confere o formato, ids de porta repetidos,
`exclusiveWith`/`only` que apontam para o nada e portas sem `src`.

### Portas

Cada porta carrega um campo `src` apontando para o caminho em `specs` de onde o
valor saiu. Quando o dado não é publicado, a porta recebe `null` e um
`note` explicando o que falta — o app mostra **"a confirmar"** e a validação
responde **"não verificável"**, nunca "ok". É a regra do projeto ("só entram
valores confirmados") levada até o diagrama.

Ajustes são declarados em `instance`:

- `pack` — o bloco representa unidades arranjáveis. Os `specs` descrevem
  **uma** célula 18650; o pack real se descreve com *Em série (S)* e *Em paralelo
  (P)*. Um 3S2P é `series: 3, parallel: 2` — seis células.

  A distinção importa: **série multiplica a tensão, paralelo não.** O paralelo
  multiplica capacidade, energia e a corrente que o pack entrega ou aceita
  carregando. O inspetor soma tudo e mostra o resultado.

  Os números de uma unidade ficam em `instance.unit`, com o campo de origem
  anotado — a capacidade usa `capacity.nominal-at-25c-typical`, porque é o que a
  nota dos `specs` manda adotar como figura de projeto.
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

Os pinos vêm de `pins` nas `ports` do componente, e cada um carrega um `signal` — o nome
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

Quais portas são obrigatórias está declarado nas `ports` (`"required": true`):
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