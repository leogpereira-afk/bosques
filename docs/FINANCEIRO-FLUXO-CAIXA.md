# Financeiro: caixa, fluxo e carteira

Interface v81 publicada e conferida em 21/10/2026. A função bsq-omie foi
publicada antes da tela e ajustada após confronto autenticado com o Omie.
A demonstração local continua isolada, somente com dados fictícios.

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
4. Caixa atual exige o contrato de saldos v2 completo e recente e usa o campo
   nSaldoAtual, posição realizada disponível hoje informada pelo Omie. Ausência
   desse campo não é substituída silenciosamente pelo saldo de outro período. No consolidado,
   entram contas ativas participantes do fluxo dos tipos CC, CX, CP, CV e PG.
   Aplicações e limites não são adicionados automaticamente ao dinheiro de caixa.
   O filtro de uma conta permite consultar sua posição individual explicitamente.
5. Extrato por conta/período preserva os campos da origem. O fechamento do período
   usa o último nSaldo por data do extrato; sem movimentos, usa nSaldoAnterior.
   nSaldoAtual não é utilizado como fechamento de um mês passado. A primeira
   linha sintética de abertura, datada no dia anterior, só é reconhecida quando
   seu identificador, valor zero, situação, natureza e saldo correspondem à abertura.
   Outras datas fora do período continuam impedindo a confirmação.
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
- 19 testes de contratos do servidor, paginação, permissões e cache histórico.
- 6 testes do cache de saldos, incluindo falha e armazenamento cheio.
- Navegação das oito áreas em 1440, 1024, 390 e 320 px, sem transbordamento da página.
- Detalhes, filtros, carteira até o último vencimento, lacunas de extrato, atualização,
  comparação, falha de rede e exportação CSV/PDF verificados na prévia isolada.
- Suítes existentes de gestão financeira, financeiro, relatórios, modernização,
  conciliação (interface, sincronização e servidor), conector Omie, falhas Omie,
  cache e auditorias financeiras/recebimentos passaram.
- Nenhum erro JavaScript ou requisição externa no teste de navegação da prévia.
- Revisão visual dos gráficos, cards, versão móvel e PDFs.

## Conferência da publicação em 21/10/2026

- Deploy da interface v81 concluído; arquivos servidos conferidos com o código local.
- Consulta real dos saldos atuais e dos extratos mensais por conta realizada pelo
  acesso autorizado, sem alteração dos lançamentos, títulos ou contratos no Omie.
- Abertura, movimentos e fechamento comparados por conta e mês, também com uma
  apuração independente no banco. Diferenças reais permanecem sinalizadas; o
  sistema não cria ajustes artificiais nem elimina registros históricos para fechar.
- Fluxo futuro e carteira confrontados com os títulos abertos e datas correspondentes.
- A posição realizada e a posição conciliada do ERP são exibidas separadamente.
  Conferência com o ERP não comprova conciliação com o extrato bancário externo.
- Nome da conta não determina atividade: inclusão segue os campos do cadastro e
  do fluxo do Omie, inclusive quando o nome contém a palavra “Inativa”.
- O cadastro completo de contas é reutilizado por até 30 minutos na leitura mensal,
  evitando consultas redundantes bloqueadas pela origem. Cada extrato mantém sua
  própria referência de conta, período e evidência de consulta.

## Limitações que permanecem visíveis

- Existem diferenças históricas entre extrato e importação. Os detalhes por mês
  mostram a conta, abertura, fechamento e diferença a conferir. A apuração real e
  seus valores estão em relatório privado, fora do repositório público.
- Ausência de contas a pagar abertas não comprova ausência de custos futuros.
  A projeção mantém aviso de cobertura parcial; custos, comissões e planejamento
  local não são somados sem classificação e vínculo que impeça duplicidade.
- Conta com rótulo de inatividade e cadastro ativo deve ser revisada no ERP pelo
  responsável; a integração não muda o cadastro nem exclui saldo pelo nome.

Referências da integração:

- https://app.omie.com.br/api/v1/financas/extrato/
- https://app.omie.com.br/api/v1/geral/contacorrente/
