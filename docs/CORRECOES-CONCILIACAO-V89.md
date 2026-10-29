# Correções de conciliação — v89

## Comportamento corrigido

- A auditoria registrada mostra a data e os apontamentos originais. Não transforma texto livre como “conferido” ou “parcialmente concluído” em um contador de pendências abertas. As filas atuais continuam separadas do histórico.
- Home, ficha, carteira e relatórios distinguem contrato confirmado, vínculo incerto, vínculo repetido e valores ainda pendentes. Um título repetido não é escolhido silenciosamente nem cobrado em mais de uma ficha.
- Origem explicitamente ausente, cancelada ou apagada fica fora da cobrança confirmada; o valor local permanece disponível para conferência. Parcelas manuais não são removidas por falta de título Omie.
- Pagamento anterior ao corte só abate a ficha quando identidade, liquidação, data e valores da origem são comprovados e não há recibo conflitante. Isso não cria lançamento no caixa nem altera o corte. A ficha identifica a parcela histórica do total pago.
- Pagamentos históricos parciais, incompletos, conflitantes ou com recibos apagados ficam em conferência, sem quitação presumida. A fila permite consultar o contrato; confirmar vínculo não substitui comprovar pagamento.
- “Vínculos e cadastros” e “Diferenças com Omie” têm filtros de período, conta e busca, paginação e composição dos motivos. IDs locais e códigos Omie da mesma conta são tratados como uma identidade. A busca encontra os lotes de todos os vínculos.
- Uma decisão local já conferida deixa de reaparecer como diferença até a origem mudar. Baixa histórica comprovada não é tratada como recibo de caixa faltante por causa do corte.

## Preservação e limites

As mudanças são de leitura, classificação e cálculo derivado. Não modificam o backend, os registros financeiros, os recibos, a lixeira, os contratos nem os documentos. Os testes usam dados fictícios.

Vencimentos concentrados, séries potencialmente sobrepostas e vínculos com documentos conflitantes continuam exigindo contrato ou comprovante. Não há redistribuição automática de datas, cancelamento de títulos nem escolha de lote por coincidência de valor.

Os índices da interface são reaproveitados somente durante a rodada síncrona e expiram em microtask. A troca de registros ou arrays invalida o índice; alterações diretas de identidade no mesmo array são relidas no evento seguinte. Os salvamentos e snapshots da aplicação substituem os registros.

## Validação reproduzível

Dependências de teste usadas: Node 24, TypeScript 5.9.3, linkedom, fake-indexeddb e PGlite. `BSQ_TEST_DEPS` aponta para a pasta que contém `node_modules`; `NODE_PATH` pode apontar para essa pasta de módulos.

```sh
node --test scripts/testar-consistencia-vinculos.cjs scripts/testar-relatorios-vinculos.cjs scripts/testar-conciliacao-classificacao.cjs scripts/testar-pagamentos-anteriores-corte.cjs scripts/testar-indice-historico.cjs scripts/testar-auditoria-financeira.cjs scripts/testar-financeiro.cjs scripts/testar-relatorios.cjs scripts/testar-gestao-financeira.cjs scripts/testar-caixa-fluxo.cjs scripts/testar-ausentes-origem.cjs scripts/testar-conciliacao.cjs scripts/testar-modernizacao.cjs scripts/testar-historico-filtros.cjs scripts/testar-plano-contas.cjs scripts/testar-fluxos-comerciais.cjs
git diff --check
```

As regressões verificam também o handler real da sincronização em memória, o formato reduzido do snapshot, ausência de mutações, preservação de caixa/DRE e casos negativos de comprovação. Os arquivos e o cache da versão 89 estão alinhados para publicação. Este documento não comprova implantação: a versão publicada deve ser conferida após o deploy.

Execução final em 29/10/2026: 16 scripts, 122 verificações reportadas pelo runner, zero falhas. A prévia local foi conferida no navegador: busca vazia, restauração do histórico, filtro por motivo, composição das verificações, baixa histórica comprovada sem recibo novo e caso duvidoso na fila sem botão de quitação.
