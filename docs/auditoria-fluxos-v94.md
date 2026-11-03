# Revisão funcional v94

## Comportamentos corrigidos

- Distratos consultáveis em Arquivadas, separados das vendas em vigor. Nenhum histórico removido.
- Ficha na lixeira permite consulta e exportação, sem ações operacionais.
- Contrato exige plano válido e gravação confirmada antes do PDF; não inventa vencimento.
- Quantidade de lotes considera contratos agrupados e evita duplicar aliases.
- Devolução combinada é distinta de saída efetivamente registrada.
- Simulador rejeita valores negativos, textos inválidos, quantidades fracionárias e datas impossíveis.
- Consultas de saldo e extrato da mesma tela não concorrem no Omie.
- Família de devoluções do plano de contas mantém identificação própria na importação, respeitando ajustes manuais.
- Backup diário é montado em transação PostgreSQL, sem transferir todos os documentos pela Edge Function.
- Saúde mostra data e quantidade da mesma cópia, com manutenção apresentada separadamente.

## Verificação

Testes usam dados fictícios. Scripts de regressão cobrem contratos, persistência,
simulação, multilotes, acessos, mapeamento de despesas, concorrência de consultas,
backup PostgreSQL, permissões, falha de gravação e preservação de cópias anteriores.
Dados comerciais e relatórios da auditoria ficam fora do repositório público.

## Limites

Uma cobrança cancelada ou ausente não comprova distrato do contrato. Alterações de
ocupação e rateios dependem de prova documental. A leitura do ERP não substitui
conciliação com extrato bancário. A projeção é parcial sem obrigações futuras.
O backup diário preserva registros e inventário de anexos; arquivos binários
permanecem no Storage privado. Isso não equivale a um ensaio de restauração total.
