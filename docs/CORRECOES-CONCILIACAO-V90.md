# Conciliação: destino sem contrato disponível

Quando nenhum contrato disponível corresponde ao CPF/CNPJ da origem, a tela
apresentava um seletor vazio e ações de confirmação sem destino possível.

A versão 90 explica o motivo, identifica a situação do contrato anterior e
oferece acesso à ficha e à consulta de contratos. Nesse estado, o seletor fica
desabilitado e não são exibidas ações de salvar ou políticas financeiras.
Havendo destino compatível, a seleção continua disponível, sem escolha automática.

Nenhuma regra de identidade, registro financeiro ou serviço de backend foi alterado.
A ausência de contrato compatível continua exigindo conferência documental.

Validação: 129 testes em 17 scripts, incluindo sete regressões novas com dados
fictícios. Os testes novos reproduzem quatro falhas na versão anterior. Conferência
visual local confirmou o estado vazio e a navegação até a ficha distratada.
