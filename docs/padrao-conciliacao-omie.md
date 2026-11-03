# Padrão de conciliação Omie e Bosques

## Objetivo

Manter carteira, recebimentos e fichas comerciais rastreáveis, sem criar dinheiro,
duplicar parcelas ou modificar condições contratuais para fazer os totais coincidirem.

## Ordem da conferência

1. Registrar a data da exportação oficial, o período, os filtros e a última sincronização.
2. Comparar toda a carteira por ID do título. Na exportação sem ID, exigir assinatura
   única de cliente, documento, parcela, vencimento, valor e emissão.
3. Conferir nominal, recebido líquido, descontos realizados, juros, multa e saldo aberto
   por título; depois somar os mesmos conjuntos nos dois sistemas.
4. Separar títulos atuais, cancelados e excluídos comprovados. Ausência em uma consulta
   incremental ou incompleta não comprova exclusão.
5. Conferir a destinação comercial: cliente, quadra, lote, observação integral, sequência
   das parcelas e situação da ficha. Nome ou valor parecido não confirma associação.
6. Simular o vínculo com o motor financeiro, incluindo todos os recebimentos existentes.
7. Gravar por transação com controle de concorrência e identificador de operação.
8. Reabrir a ficha, conferir o histórico e repetir a soma da carteira após sincronizar.

## Critérios de decisão

| Evidência | Tratamento |
| --- | --- |
| Mesmo ID de origem e vínculo já confirmado | Atualizar conforme a política registrada; preservar ajustes manuais e histórico. |
| Cliente, observação e lote exatos; destino único e sem sobreposição | Vincular título existente à ficha existente; usar o recebimento original. |
| Título de vários lotes | Contar o título uma vez. Não dividir dinheiro igualmente sem regra comprovada. |
| Ficha sem identificação, mas lote já vendido e títulos inequívocos | Completar a identidade com prova de origem, preservando o plano e a rastreabilidade. |
| Cliente diferente no mesmo lote ou contrato com condições divergentes | Registrar a cadeia de evidências e a decisão necessária; impedir falsa disponibilidade. |
| Desistência comprovada | Preservar pagamentos. Desistência não comprova estorno, devolução ou data de distrato formal. |
| Documento incompatível com a ficha | Corrigir o rótulo, preservar o arquivo e solicitar o documento correto. |
| Caso já classificado como sem venda | Preservar a decisão e não reabrir automaticamente. |

## Fechamento de cada correção

Guardar fonte, motivo, antes/depois, responsável, horário e operação. Conferir que os
valores e datas autorizados foram preservados, o caixa não foi duplicado, as parcelas
anteriores continuam intactas e o espelho comercial não liberou um lote comprometido.
Pendências devem indicar a contradição concreta, o documento necessário e o próximo passo.
Os totais das filas de análise não devem ser somados ao saldo financeiro: são recortes
da mesma carteira e podem se sobrepor.
