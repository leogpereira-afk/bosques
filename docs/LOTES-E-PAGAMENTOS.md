# Seleção de lotes e pagamentos

Em **Financeiro → Conciliação → Selecionar lotes e pagamentos**, a gestão pode
selecionar os cadastros que representam um único contrato físico, escolher o
código principal e revisar os recebimentos e títulos correspondentes.

A seleção exige o mesmo CPF/CNPJ e uma confirmação das condições do contrato
inteiro. A entrada pode estar nos próprios boletos; nesse caso ela não é
somada novamente ao saldo. As condições de um cadastro não são multiplicadas
automaticamente pelo número de lotes.

Os títulos e recebimentos já associados aos contratos selecionados acompanham
o grupo. Recebimentos ou títulos avulsos dependem de seleção explícita. A
revisão mostra o conjunto e o total dos recebimentos antes da confirmação.

A gravação é transacional, valida as versões lidas e usa uma chave idempotente.
Um conflito interrompe toda a operação. O contrato principal passa a conter
todos os lotes; os cadastros incorporados continuam consultáveis pelo histórico,
sem duplicar títulos, recebimentos, VGV ou estoque vendido. Valores e datas dos
recebimentos permanecem iguais. Descontos locais conflitantes exigem revisão.

## Entrada sem vínculo com venda

Na conferência de um recebimento sem contrato disponível, **Entrada sem vínculo
com venda** registra uma decisão e seu motivo. O fato bancário permanece no
caixa e aparece separado das receitas de venda, sem atribuir automaticamente
uma natureza contábil. Quando há um título, a classificação do título é a
referência para seus recebimentos associados.

**Entradas sem venda** permite consultar as classificações e reabrir a
conferência. Reabrir não escolhe um contrato nem restaura vínculos antigos.
Os automatismos do Omie respeitam tanto a classificação quanto a reabertura.

## Verificação

Os testes usam dados fictícios e cobrem seleção, revisão antes da gravação,
controle de versão, idempotência, rollback, CPF divergente, títulos conflitantes,
estoque com vários lotes, relatórios, PDFs e sincronização. Não é necessário
alterar registros de produção para verificar esses fluxos.
