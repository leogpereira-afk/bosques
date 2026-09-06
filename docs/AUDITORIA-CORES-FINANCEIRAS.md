# Auditoria das cores financeiras — 06/09/2026

Padrão: valores de entrada em azul (#1d4ed8); despesas, pagamentos, comissões e custos futuros em vermelho (#b83232). Cor acompanha a natureza do lançamento, mesmo quando há vínculo com uma venda. Valores de resultado usam seu sinal; transferências internas e somas de naturezas diferentes ficam neutras.

## Problemas encontrados e corrigidos

| Área | Problema | Correção |
|---|---|---|
| Classificação | Vínculo com venda tinha prioridade sobre o tipo saída | Tipo de saída, obrigação e título a pagar têm prioridade |
| Caixa anterior | Valores e totais anuais sem cor; categorias de despesa sem cor | Valores, subtotais e barras classificados pela natureza |
| Pendências | Total continuava neutro mesmo com apenas saídas | Total acompanha a natureza quando todos os itens têm a mesma classificação |
| Corretores | Comissão já paga verde; valores combinados e rateios neutros | Comissões pagas, devidas e valores de rateio vermelhos |
| Cronograma | Pago verde; custos e despesas vinculadas neutros | Previsão, pago, falta pagar e campos monetários vermelhos |
| Detalhes | Valores em formulários, conciliação e movimentos bancários neutros | Valores e campos classificados; transferência continua neutra |
| PDFs | Valores de despesas, DRE e cronograma sem cor; entradas verdes | Cores aplicadas aos valores e totais exportados |

## Verificações realizadas

- Reproduzida a classificação incorreta de uma saída ligada a venda antes da correção; regressão passa após a correção.
- 17 verificações de classificação, incluindo entradas, saídas, títulos, transferências e totais mistos.
- Verificação da cor usada pelo jsPDF ao escrever valores em despesas, recebimentos, listas mistas, cronograma, DRE e previsões.
- Testes financeiros existentes e testes do histórico mensal.
- Auditoria no navegador com dados fictícios em Relatórios, Caixa, Corretores, Cronograma e abas financeiras; conferência de formulários de despesa e parcela a pagar.
- Relatórios na largura de 390 px, sem transbordamento horizontal da página e sem valores marcados como saída fora do vermelho.

A validação visual usou uma cópia isolada com dados fictícios. Nenhum lançamento real foi criado ou alterado. A auditoria cobre apresentação financeira, não reconciliação dos dados contábeis nem conteúdo antigo de texto livre no histórico.
