# Financeiro — versão 49

A área Financeiro reúne recebimentos, despesas, contas a receber e pagar, diferenças com o Omie, centros de custo e contas bancárias.

## Resolver pendências

Os cartões de vínculos abrem apenas o grupo selecionado, em lista numerada da data mais antiga para a mais recente. Clique na linha para associar corretor, etapa, categoria ou lote. As pendências resolvidas deixam de aparecer no grupo. A atualização local ainda precisa ser enviada ao servidor; acompanhe o indicador de sincronização.

## Valores e origem

A comparação usa identificador do título, valor liquidado e data. Coincidências de valor e data não confirmam duplicidade. Possíveis duplicidades ficam separadas para conferência documental. Correções locais continuam visíveis como diferenças; não alteram o ERP.

Recebimentos são alocados a parcelas por identificador estável. Data de pagamento sozinha não comprova quitação. Descontos efetivamente liquidados na origem e condições contratuais confirmadas são tratados separadamente. Entradas não são consideradas recebidas sem um recebimento registrado.

## Centros de custo

Em Centros de custo, cadastre ou renomeie. A renomeação acompanha os vínculos nas despesas e parcelas, com histórico. Abra uma despesa ou parcela para corrigir sua classificação. A classificação local não é enviada ao Omie.

## Validação

Testes de pagamentos parciais, estornos, desconto, vínculo transacional, renomeação e rejeição de centro duplicado. Revisão das 15 telas em 1440 e 390 pixels e das abas financeiras até 320 pixels. Testes usam cópias privadas ou dados fictícios, sem gravar no ERP.

A conclusão da sincronização não significa conciliação integral: vínculos, classificações e correspondências pendentes permanecem identificados.

## Revisão 51: simulador e auditoria

O simulador permite escolher lote, comparar planos, editar preço e entrada e conferir todas as faixas. No celular, as linhas viram cartões para manter os valores visíveis.

As filas de pendências permitem editar no mesmo contexto, sem mudar de aba. O valor de caixa da integração utiliza `resumo.nValLiquido` (pago menos desconto, mais juros e multa), preservando `nValPago` no original. Valores em aberto são obtidos de `nValAberto`. Isso impede tratar encargos de um título liquidado como nova dívida.

Fonte técnica: https://app.omie.com.br/api/v1/financas/mf/

Os indicadores comerciais distinguem contratos ativos, quitados e lotes vendidos. Um contrato quitado continua ocupando um lote vendido. A origem de cada indicador é explícita; pendências de vínculo não são escondidas no total do Omie.
