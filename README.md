# Portal dos Bosques — Gestão do Loteamento

Sistema da Associação Campestre Portal dos Bosques (Montes Claros/MG):
espelho de lotes, propostas pelo WhatsApp, vendas com carnê, recebimentos,
distratos, contratos guardados, caixa e comissões.

Mesma família da Domo Construtora e do Diamond Vendas: **HTML/CSS/JS puro,
sem build**, offline-first (PWA), backend em **Edge Functions do Supabase**
(Postgres + Storage), publicado como site estático.

## O modo híbrido (como está hoje)

A operação continua digitando na **planilha** (`GerenciadorLoteamento.xlsx`).
O sistema é atualizado dela quando quiser:

```bash
./scripts/atualizar-da-planilha.sh    # extrai → gera → sobe (pede a senha da direção)
```

Reimportar **atualiza sem duplicar** (a mesma linha da planilha tem sempre o
mesmo id) e respeita a divisão de posse:

| Quem manda | No quê |
|---|---|
| **Planilha** | lotes, clientes, corretores, vendas (dados do plano), despesas, outras receitas, comissões pagas |
| **Sistema** | baixas de parcela, propostas enviadas, contratos anexados, distratos, quitações, estornos |

O que sumir da planilha vai para a **lixeira** (não é apagado de vez). A
situação de uma venda que já existe no sistema NUNCA é sobrescrita pela
reimportação — distrato feito no app não "desdistrata".

Pendências de cada importação: `seed/CONFERIR.md`.

⚠️ **`seed/` está no .gitignore de propósito**: tem CPF e endereço de cliente,
e este repositório é público. Nunca tirar do gitignore.

## A API (aberta para integrar)

O backend é uma API JSON simples — qualquer ferramenta (n8n, script, ERP
futuro) pode alimentar ou ler. Tudo é `POST` com corpo JSON:

```
POST https://<projeto>.supabase.co/functions/v1/bsq-nucleo
headers:
  content-type: application/json
  x-token: <TOKEN leve — o mesmo do config.js>
  x-senha: <sha256 da senha, em hex>       ← quem autoriza de verdade
  x-quem:  <nome de quem assina, URL-encoded (opcional)>
corpo: { "action": "<ação>", ...parâmetros }
```

Ações principais:

| action | o que faz |
|---|---|
| `snapshot` | devolve tudo (cfg + registros), filtrado pelo perfil |
| `salvarLote` | grava registros `{itens:[{colecao, registro}]}` — recusa item a item, com motivo |
| `apagar` / `restaurarItem` | lixeira (estorno de recebimento passa por aqui, com log) |
| `importar` | o modo híbrido: upsert por id + poda do que saiu da planilha + recálculo dos lotes |
| `backup` / `restaurar` | cópia completa / restauração |
| `log` | trilha de quem fez o quê |

Coleções: `lote`, `cliente`, `corretor`, `venda` (VD-0001…), `prop` (PR-…),
`rec` (RB-… — cada dinheiro recebido de venda), `cx` (lançamento avulso de
caixa), `doc`.

**Regras que o servidor faz valer** (não adianta mandar diferente):
um lote só tem uma venda viva; o status do lote é derivado da venda;
recebimento nasce com autor carimbado e não muda de valor (estorna e lança
de novo); corretor só grava proposta, e só a própria.

Arquivos (contratos, PDFs): `bsq-acervo`, protocolo em partes de 2,5 MB
(`iniciar → parte → finalizar → baixarParte`).

Proposta pública (link do WhatsApp): `bsq-p/<id>/<token>` — landing com
teaser + PDF; cada abertura e clique ficam gravados na proposta.

## O carnê (o miolo)

O carnê **nunca é gravado** — é derivado do plano da venda + recebimentos
(`carne.js`, funções puras com testes: `./scripts/testar.sh`).

- Parcela **Fixa**: mesmo valor até o fim.
- Parcela **Reajustada**: +6% a cada 12 parcelas (configurável em
  Configurações — regra assumida da planilha, confirmar com a direção).
- Baixa sem parcela indicada aplica na mais antiga em aberto (FIFO); troco
  rola para a seguinte; pagamento parcial fica parcial.

## Estrutura

```
index.html        casca; ordem dos scripts importa (ui declara TELAS)
config.js         TOKEN leve + endereços (SEM segredo de verdade)
store.js          offline-first: cache local, fila, sync 90s (porte da Domo)
ui.js             fmt, modal, toast, campos (porte da Domo)
carne.js          motor do carnê (puro, testado)
pdf.js            proposta e recibo (jsPDF vendorado)
espelho.js        espelho + ficha do lote + simulador + proposta
vendas.js         vendas, carnê, baixa, distrato, anexos, propostas
caixa.js          caixa mensal + comissões
cadastros.js      clientes e corretores
app.js            login, menu, roteador, painel, configurações

supabase/
  migrations/     0001 schema (bsq_*) · 0002 pg_cron da rotina
  functions/
    _shared/      colecoes, acesso (perfis), dados (Postgres), cors, arquivos
    bsq-nucleo/   a porta de dados (todas as regras)
    bsq-acervo/   arquivos em partes (Storage)
    bsq-p/        landing pública da proposta
    bsq-rotina/   backup diário + limpezas (pg_cron 03:10)

scripts/
  extrair-planilha.py       xlsx → seed/*.json (bate com o Totalizador no centavo)
  gerar-import.py           seed → importar.json (ids determinísticos) + CONFERIR.md
  subir-import.sh           manda o importar.json para a ação 'importar'
  atualizar-da-planilha.sh  os três acima numa tacada (o botão do modo híbrido)
  testar.sh                 testes do carnê (jsc do macOS, sem node)
  checar-js.sh              checagem de sintaxe de todos os .js
```

## Perfis

| perfil | pode |
|---|---|
| **direcao** | tudo (config, acessos, lixeira, backup, log) |
| **escritorio** | opera: vendas, baixas, caixa, cadastros, contratos |
| **corretor** | espelho e as PRÓPRIAS propostas — nunca vê o dinheiro da casa |

A senha da equipe (env `BSQ_PAINEL_SENHA` até a primeira troca) vale como
direção. Acessos individuais em Configurações → um por pessoa, o histórico
diz quem fez.

## Publicar

Deploy: siga o `DEPLOY.md`. A cada publicação do front, **subir o `CACHE` do
sw.js e o `VERSAO` do config.js** — senão o navegador serve o arquivo velho.
