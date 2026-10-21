# Conciliação financeira

Fluxo de gestão e escritório em **Financeiro → Conciliação**. Não confirma
associações automaticamente, não escreve no Omie e não altera os movimentos
bancários usados nos relatórios.

## Conferência

1. Escolher a fila de recebimentos, parcelas/títulos ou possíveis duplicidades.
2. Consultar pessoa, CPF/CNPJ, documento, contrato, conta, datas e valores.
   Sugestões explicam coincidências; nenhuma é uma confirmação.
3. Selecionar o contrato e a decisão sobre **valor nominal e vencimento**:
   - Origem: adota os dados atuais do título Omie.
   - Local: mantém os dados da parcela conferida. Uma futura mudança na origem
     volta a aparecer na fila.
   - Pendente: confirma o contrato, mantendo a conferência financeira aberta.
4. Informar motivo/documento e confirmar. “Salvar e próximo” mantém o filtro.

O filtro “Valor / vencimento” inclui também diferenças em títulos cujo vínculo
ainda está incerto. Uma parcela pode aparecer em duas filas. Quantidades não devem ser somadas como
dívida. Recebimentos manuais sem distribuição continuam pendentes mesmo após
identificar o contrato. A distribuição usa o editor existente; contratos sem
espelho de parcelas precisam ter o plano conferido na venda.

Uma possível duplicidade exige decidir explicitamente entre o mesmo pagamento
ou pagamentos distintos. A coincidência de data e valor não comprova identidade.
Se houver cópia importada redundante, a decisão explícita mantém o manual e
envia somente a cópia identificada à lixeira com histórico; não há exclusão
definitiva.

## Proteção das decisões

`conciliarFinanceiro` aceita apenas direção/escritório. A RPC é exclusiva do
servidor, transacional e verifica as versões lidas. CPF divergente, contrato
distratado, fonte cancelada e registros na lixeira são recusados.

O identificador da operação torna a nova tentativa idempotente. Falha de leitura
após a confirmação não autoriza repetir eventos nem lançamentos. Conflito
HTTP 409 exige reler e conferir novamente.

A sincronização captura uma revisão antes de montar a página e grava todos os
registros financeiros dessa página numa transação que compara a mesma revisão.
Uma decisão humana no intervalo impede a gravação do retrato antigo. O próximo
ciclo relê os dados; não pode ressuscitar a cópia já conciliada.

## Validação e publicação

Prévia isolada: `preview-bosques.html?conciliacao=1#/financeiro`, somente em
localhost, com pessoas/documentos fictícios e conexões externas bloqueadas.
Os testes de servidor usam PostgreSQL isolado (PGlite), sem dados reais.

Antes de publicar: aplicar as duas migrações da conciliação, publicar
`bsq-omie`, aguardar o encerramento das invocações da versão anterior, publicar
`bsq-nucleo`, verificar as respostas autenticadas e só então disponibilizar a
interface v80. Confirmar a execução de um ciclo Omie. Não
executar uma associação real como teste de implantação.

Publicação autorizada em 21/10/2026: migrações aplicadas e serviços `bsq-omie` e
`bsq-nucleo` na versão 91. A sincronização automática foi conferida após a
implantação. Nenhuma associação real foi executada na validação; as decisões
sobre cada registro permanecem a cargo da gestão.
