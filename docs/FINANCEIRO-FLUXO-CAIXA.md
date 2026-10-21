# Financeiro: caixa, fluxo e carteira

Implementação local para revisão. Não publicada. A demonstração usa somente
dados fictícios e não consulta nem altera registros de produção.

## Organização

- Visão geral: quatro indicadores, dois gráficos, detalhes adicionais recolhidos.
- Fluxo de caixa: hoje, 7/30/60/90 dias, 12 meses, ano, intervalo e último vencimento.
- Caixa e contas: posição atual por conta, extratos históricos e fechamento mensal/anual.
- A receber/A pagar: carteira completa, distribuição por ano/mês, atrasos e títulos.
- Lançamentos, retiradas e conciliação preservados; relatórios compartilham FIN_GESTAO.
- Filtros por conta e período, comparação, CSV e PDF conservam o contexto da consulta.

## Regras de cálculo

1. Valores são somados em centavos. Ausência, texto vazio ou formato inválido não
   vira zero. Zero e saldo negativo são valores válidos.
2. Realizado usa a data de pagamento dos movimentos importados. A data de crédito,
   emissão e vencimento permanece visível no detalhe. Transferências ficam separadas.
3. Carteira usa o saldo aberto atual dos títulos no Omie, pela data de vencimento.
   A opção Todos os anos inclui todos os vencimentos importados e identifica itens
   sem data. Não recompõe a carteira histórica de um encerramento passado.
4. Caixa atual exige o contrato de saldos v2 completo e recente. No consolidado,
   entram contas ativas participantes do fluxo dos tipos CC, CX, CP, CV e PG.
   Aplicações e limites não são adicionados automaticamente ao dinheiro de caixa.
   O filtro de uma conta permite consultar sua posição individual explicitamente.
5. Extrato por conta/período preserva os campos da origem. O fechamento do período
   usa o último nSaldo por data do extrato; sem movimentos, usa nSaldoAnterior.
   nSaldoAtual não é utilizado como fechamento de um mês passado.
6. Histórico só recebe "Conferido com extrato" quando abertura mais movimentos e
   transferências corresponde ao fechamento de cada conta incluída. Sem base,
   mostra os movimentos conhecidos e o saldo não comprovado. O resumo anual também
   exige continuidade entre o fechamento de um mês e a abertura do seguinte.
7. Projeção parte da posição atual confirmada e soma apenas títulos futuros após
   a data de corte. Vencidos, sem data e títulos do próprio dia ficam separados.
   O horizonte personalizado inclui no acumulado os títulos entre o corte e seu
   início. A menor posição é apurada por dia, inclusive em gráficos mensais.
8. Sem posição válida, mostra fluxo líquido previsto, não saldo projetado.
   Planejamento e comissões locais permanecem em camada própria até comprovar
   correspondência com o Omie. A projeção sinaliza cobertura parcial; ausência de
   contas a pagar abertas não comprova ausência de obrigações futuras.
9. Comparativos informam as datas comparadas. Mês/ano em andamento pode usar
   intervalos equivalentes; meses completos são opção separada. Percentual só
   aparece com base válida e positiva. Movimentos conhecidos não comprovam a
   completude histórica.

## Integração e proteção de dados

As novas ações da função bsq-omie são saldos (contrato v2), extratoCaixa e
historicoSaldos. Usam a autenticação e as permissões existentes, recusando acesso
anônimo e corretor. Paginação validada na origem e na leitura do histórico.

Evidências de consulta são preservadas na coleção privada bsq_meta por conta,
período e horário, além da referência para a leitura mais recente. Elas contêm
apenas os campos necessários para conferir saldos, sem descrição livre ou CPF.
As ações não alteram títulos, contratos ou decisões da conciliação.

Falhas mantêm a última leitura válida identificada como antiga; resposta parcial
não substitui o cache completo. A tela distingue atualização do aparelho,
sincronização, consulta do saldo e cobertura dos movimentos.

## Verificação local em 21/10/2026

- 23 testes de cálculo, horizonte, carteira, transferências e comparativos.
- 13 testes de contratos do servidor, paginação, permissões e cache histórico.
- 6 testes do cache de saldos, incluindo falha e armazenamento cheio.
- Navegação das oito áreas em 1440, 1024, 390 e 320 px, sem transbordamento da página.
- Detalhes, filtros, carteira até o último vencimento, lacunas de extrato, atualização,
  comparação, falha de rede e exportação CSV/PDF verificados na prévia isolada.
- Suítes existentes de gestão financeira, financeiro, relatórios, modernização,
  conciliação (interface, sincronização e servidor), conector Omie, falhas Omie,
  cache e auditorias financeiras/recebimentos passaram.
- Nenhum erro JavaScript ou requisição externa no teste de navegação da prévia.
- Revisão visual dos gráficos, cards, versão móvel e PDFs.

## Pendências para uma publicação autorizada

1. Publicar primeiro a função bsq-omie com o contrato v2, preservando o controle
   existente de autenticação, antes da interface que o utiliza.
2. Fazer consulta somente leitura e confrontar conta/data/abertura/fechamento com
   o extrato real no Omie. Conferir contas incluídas/excluídas e os campos de saldo.
   As respostas simuladas usadas nos testes não substituem essa conferência.
3. Confirmar cobertura das saídas futuras, comissões e planejamento. Não incluir
   obrigações locais na projeção sem classificação e vínculo que evite duplicidade.
4. Após os contratos e valores reais conferidos, preparar versão dos assets/cache,
   publicar a interface e conferir produção autenticada, celular e exportações.

Referências da integração:

- https://app.omie.com.br/api/v1/financas/extrato/
- https://app.omie.com.br/api/v1/geral/contacorrente/
