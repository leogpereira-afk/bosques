# Previsão mensal dos lotes vendidos

Entrega v92 preparada em 02/11/2026 sobre `origin/main` `fb08873`.
Publicação autorizada após aprovação da prévia, com exportação em PDF.
Ramo: `codex/previsao-mensal`.

## Local e uso

Financeiro → A receber → Previsão por mês dos lotes vendidos.
O painel inteiro e cada ano podem ser recolhidos. O ano atual começa aberto;
os comandos Expandir anos / Recolher anos controlam todos os anos. Cada mês
abre suas parcelas, cliente, lote, recebido, saldo e acesso à venda. A tabela
de valores exatos permanece recolhida até ser solicitada.

O botão Salvar PDF exporta o resumo, os gráficos de todos os anos e os
valores mensais exatos. Anos recolhidos na tela também entram no arquivo.
O PDF é estático e não muda o estado expandido/recolhido do painel. Pendências,
planos sem espelho e créditos aparecem separados, sem inflar os totais.

## Bases dos números

- Usa `FINANCEIRO.vendaAtiva` e `resumoVenda`, incluindo contratos quitados,
  excluindo apagados, distratados e incorporados em outro contrato.
- A posição atual das parcelas é agrupada pelo vencimento. Não é fluxo de
  caixa por data de recebimento nem saldo histórico de fechamento.
- Contratos conjuntos somam cada parcela uma única vez.
- Recebido e saldo são calculados pelo motor existente. Créditos excedentes,
  recebimentos sem parcela, planos sem espelho e parcelas a conferir ficam
  fora das barras e têm consulta própria.
- Usa todos os vencimentos e contas dos contratos, independentemente dos
  filtros da consulta de títulos que aparece abaixo. Esse escopo está escrito
  no cabeçalho e na orientação do painel.
- Não grava dados nem modifica títulos, recibos, vínculos ou histórico.

## Verificação

- 17 testes do novo agregador (`scripts/testar-previsao-vendas.cjs`).
- 21 verificações do motor financeiro e sintaxe (`scripts/testar-financeiro.cjs`).
- 5 testes do índice histórico (`scripts/testar-indice-historico.cjs`).
- Regressão da gestão financeira (`scripts/testar-gestao-financeira.cjs`).
- Exportação com jsPDF real (`scripts/testar-previsao-pdf.cjs`), incluindo
  carteira vazia, vários anos, paginação, totais e preservação da fonte.
- Sintaxe de todos os JS, dependências de quatro entradas HTML e `git diff --check`.
- Navegador: expandir/recolher painel e anos, abrir mês, abrir venda, consultar
  pendências, planos e tabela exata. Totais idênticos após recarga.
- Larguras 390 e 320 px: documento sem excesso horizontal; meses deslizam
  dentro de cada ano. Conferência feita com dados exclusivamente fictícios.

Prévia: `preview-recebiveis.html#/financeiro`, protegida para localhost e com
requisições externas bloqueadas pelo ambiente de demonstração existente.

## Publicação e conferência

Versão da casca atualizada em config.js / sw.js; novos arquivos registrados
no service worker e nos pontos de entrada. Conferir o deploy, os arquivos
servidos e a URL oficial após publicar. Testes sintéticos e a conferência de
renderização não substituem uma auditoria de todos os títulos no Omie.
