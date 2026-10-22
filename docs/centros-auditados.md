# Vínculos auditados de centros

O cadastro gerencial local e o catálogo de departamentos do Omie são relacionados pelo código oficial e pelo nome conferido. Planos e evidências reais permanecem privados em `bsq_meta`, nunca no repositório.

O executor existente de correções admite planos `modo: centros` exclusivamente na sessão pessoal da direção. Cada item contém o título de origem, categoria e observação esperadas, evidência e um destino exclusivo de 100%. Rateios compartilhados não são inferidos.

Antes de alterar, consulta novamente o título e recusa divergências em valores, datas, contas, favorecidos, pagamentos, impostos ou classificações anteriores. Preserva uma cópia integral antes de `AlterarContaPagar`; baixa, conciliação e aprendizado automático ficam desativados. Não há exclusão ou criação de pagamento.

Após o envio, exige releitura integral e consulta individual independente. A confirmação aguarda ao menos 60 segundos porque a consulta pontual pode devolver uma versão anterior. Uma retomada consulta novamente, sem reenviar itens já enviados. Resultado inconclusivo exige investigação.

A sincronização solicita explicitamente `cExibirDepartamentos: S`. Assim, o rateio oficial acompanha títulos e movimentos bancários; os relatórios continuam somando o movimento uma única vez. Valores não classificados permanecem no grupo sem centro.

Verificação: `scripts/testar-centros-auditados.cjs`, `testar-correcao-auditada.cjs`, `testar-isolamento-auditoria.cjs` e `testar-omie-conector.cjs`. Usam somente dados fictícios. A validação de produção compara títulos, baixas e totais antes/depois e guarda as pendências separadas.
