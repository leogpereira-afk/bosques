// config.js — endereços do backend e o token leve anti-robô.
//
// O TOKEN não é segredo de verdade (o repositório é público): ele só barra
// robô e curioso casual. O que abre a porta é a SENHA, conferida no servidor
// (x-senha). Mesmo desenho da Domo Construtora.
//
// Backend: projeto Supabase "Projetos Léo" (compartilhado com Domo e Diamond,
// namespace bsq_*). Os segredos das functions são BSQ_TOKEN / BSQ_PAINEL_SENHA
// / BSQ_ROTINA_TOKEN — os nomes crus (TOKEN, PAINEL_SENHA…) são DA DOMO.
window.TOKEN = 'bsq-6f4e21c9a48d503b7e19d2c6b0a58f37';
window.API_BASE = 'https://reoghclxripktzpdwhiy.supabase.co/functions/v1';
window.API = window.API_BASE + '/bsq-nucleo';
window.API_ARQ = window.API_BASE + '/bsq-acervo';
window.P_URL = window.API_BASE + '/bsq-p'; // landing pública da proposta

window.VERSAO = '16'; // suba a cada publicação, junto com o CACHE do sw.js
