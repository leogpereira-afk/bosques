# Divisão entre contratos independentes — prévia

Dentro de **Financeiro → Conciliação → Conferir e vincular**, use
**Contratos de destino** para marcar um, dois ou mais contratos no próprio
campo. Com vários selecionados, clique em **Continuar com N contratos**.
Os contratos continuam separados. Informe a parte
nominal de cada um e distribua cada recebimento já existente. Confira a soma,
registre o documento/motivo e revise antes de confirmar.

Exemplo fictício: título de R$ 6.000 e um recebimento de R$ 6.000, dividido em
R$ 3.000 para cada contrato. O caixa permanece com um recebimento. As futuras
prestações, comissões e anexos permanecem em cada ficha. Quando esta é a entrada
já cadastrada fora do espelho, confirme a inclusão no espelho para não somá-la
novamente; o sistema exige correspondência exata com a entrada de cada ficha.

## Escolher a ação correta

- **Contratos de destino → um selecionado**: mantém a conciliação individual.
- **Contratos de destino → vários selecionados**: abre a distribuição do título
  entre contratos independentes. Voltar preserva a seleção e o motivo informado.
- **Selecionar lotes e pagamentos**: cobrança conjunta já comprovada, usando o
  fluxo de agrupamento existente.
- **Entrada sem vínculo com venda**: classificação específica existente, com
  justificativa; não cria uma venda por suposição.

A revisão de um recebimento distribuído abre novamente a divisão. O atalho de
estorno/recibo integral é retirado da visualização da parte de uma ficha, para
não atribuir ou estornar todo o recebimento por engano.

## Persistência e sincronização

Uma RPC transacional grava as partes, o histórico e o título de origem. Compara
as versões de todos os registros, exige fechamento em centavos e usa uma chave
idempotente para evitar repetição. A permissão é de direção ou escritório, com
execução SQL restrita ao serviço. Proteções impedem que rotinas antigas destruam
um rateio. Alterações posteriores no Omie geram conferência em vez de repartir
valores automaticamente. Recebimentos rateados com ID manual não geram uma
segunda entrada automática.

Não há rateio automático de juros, multas ou descontos. Esses casos continuam
pendentes de conferência específica. Contratos de pessoas diferentes ou
indisponíveis não são selecionáveis. Publicar requer a migração SQL e as duas
Edge Functions antes dos arquivos da interface e renovação do cache do site.

## Verificação local

- `scripts/testar-rateio-contratos.cjs`: PostgreSQL em memória; 2/3 contratos,
  pagamentos parciais, centavos, rollback, versões, idempotência, preservação de
  histórico/anexos/comissões, entrada única no espelho e proteção de edição.
- `scripts/testar-destinos-multiplos.cjs`: seleção de um, dois e três contratos
  no próprio campo, bloqueio de envio individual para múltiplos e retorno.
- `scripts/testar-rateio-ui.cjs`: DOM isolado; revisão, permissões, resposta sem
  confirmação e retomada após falha de leitura sem duplicar a gravação.
- `scripts/testar-rateio-sync.cjs`: handler real com transporte Omie simulado;
  repetição, mudança na origem e recebimento manual já distribuído.
- Navegador: formulário, diferença inválida, salvar, recarregar, fichas e
  histórico; largura de celular de 390 px.

Prévia: executar `node scripts/preview-rateio-server.cjs` com PGlite disponível
em `BSQ_PGLITE_DEPS`. Dados exclusivamente fictícios. Banco em memória: recarregar
a página preserva o teste; reiniciar o servidor reinicia a demonstração.
**Nenhuma alteração de produção ou de registros reais foi feita nesta prévia.**

Resultado desta rodada: 25 verificações de banco e 47 subtestes de regressão/DOM
passaram. O executor legado `testar-financeiro-ui.cjs` não conseguiu iniciar seu
Chrome headless neste ambiente; a conferência visual de salvar, recarregar,
fichas, histórico e celular foi feita pela sessão de navegador disponível.
A validação de produção e da API Omie real fica para depois da publicação.
