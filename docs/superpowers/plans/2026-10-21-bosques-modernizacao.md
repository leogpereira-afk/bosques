# Modernização Bosques: plano de implementação

> Para execução: desenvolvimento por tarefas independentes, revisão e verificação antes da entrega.

**Objetivo:** modernizar o Bosques e corrigir falhas confirmadas preservando registros e regras financeiras existentes.
**Autorização:** usuário aprovou implementação e prévia sem publicação em 21/10/2026; autorizou trabalho sem AGENTS.md/VEZ.md.
**Arquitetura:** preservar HTML/CSS/JS, rotas e API existentes. Usar novos ativos SVG com aparência 3D, componentes compactos e correções locais de fluxo. Nenhuma chamada de gravação produtiva nos testes.
**Base:** 134bcc359735f8fc660664a03b30e79e65ac520b, branch codex/modernizacao-20261021.

## Restrições
- Não publicar, push ou implantar servidor.
- Dados reais, tokens e cópias do banco ficam fora do repositório público.
- Prévia usa dados fictícios e bloqueia chamadas de rede de gravação.
- Preservar regras de cálculo oficiais, permissões e integrações; não alterar situação de venda real.

## Tarefa 1: gravação e acessibilidade
Arquivos: store.js, ui.js, scripts/testar-confiabilidade.cjs, scripts/testar-acessibilidade.cjs.
- [x] Reproduzir espera de envio, armazenamento cheio e recusa parcial com rede simulada.
- [x] Persistir antes de confirmar salvar; manter fila e erro de itens recusados, sem retry infinito.
- [x] Compartilhar promessa de envio; quem aguarda subirFila espera envio em andamento.
- [x] Rotular campos, nomear modal e conter/retornar foco, preservar fluxos existentes.
- [x] Executar testes relevantes e relatar comandos/resultados.

## Tarefa 2: negociação e cobrança
Arquivos: espelho.js, vendas.js, carne.js, scripts/testar-fluxos-comerciais.cjs.
- [x] Reproduzir cobranças divergentes, cópia de link rejeitada e datas no fim do mês.
- [x] Usar a mesma base financeira para cobrança e detalhes; preservar cálculo oficial.
- [x] Preservar interessado e condições da entrada na conversão de proposta.
- [x] Oferecer baixa da entrada quando pendente; rejeitar valores negativos sem alterar critérios de negócio.
- [x] Executar suíte de carnê, financeiro, vendas e propostas com dados sintéticos.

## Tarefa 3: identidade visual
Arquivos: modernizacao.css, icons/3d/*.svg.
- [x] Criar família de imagens SVG isométricas com verde Bosques, sem recolorir logo.
- [x] Estilizar shell, topo, ações, KPIs, atalhos, cartões, listas, formulários e estados.
- [x] Boa legibilidade, foco visível, alvos de toque 44px, mobile e redução de movimento.
- [x] Não esconder informações ou substituir estados por cor apenas.

## Tarefa 4: shell e prévia
Arquivos: app.js, index.html, preview-bosques.html, preview-bosques-data.js, scripts/testar-modernizacao.cjs.
- [x] Evitar localStorage.clear; proteger pendências na saída e limpar somente chaves do Bosques.
- [x] Preservar digitação fora de modais durante atualização automática e anunciar nova base disponível.
- [x] Dar acesso rápido a lote, simulador, propostas e financeiro respeitando perfil.
- [x] Mostrar prioridades, resumo e próximo passo em cards compactos com ícones 3D.
- [x] Criar prévia local completa com dados fictícios e servidor sem gravação produtiva.

## Verificação final
- [x] Sintaxe de todos os scripts, testes existentes e regressões novas.
- [x] Revisão de diff e de segurança de dados/segredos.
- [x] Revisão independente dos defeitos de gravação, propostas e logout.
- [x] Conferência no navegador de todas as áreas e fluxos da prévia, erros e responsividade.
- [x] Entregar prévia, correções, verificações e limites reais. Publicação depende de nova autorização.
