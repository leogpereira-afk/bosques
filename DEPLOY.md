# Como o Portal dos Bosques está no ar

Deployado em **21/08/2026** — não num projeto próprio, mas dentro do projeto
Supabase **"Projetos Léo"** (`reoghclxripktzpdwhiy`), o mesmo da Domo e do
Diamond, como terceiro sistema em namespace.

## O mapa do projeto compartilhado

| Sistema | Tabelas | Functions | Segredos |
|---|---|---|---|
| Domo | `domo_*` | `domo-nucleo/acervo/rotina` | `TOKEN`, `PAINEL_SENHA`, `ROTINA_TOKEN` (os nomes CRUS são da Domo!) |
| Diamond | Blobs-shim | `dmd-api`, `dmd-p` | `DMD_TOKEN` |
| **Bosques** | `bsq_*` | `bsq-nucleo/acervo/p/rotina` | `BSQ_TOKEN`, `BSQ_PAINEL_SENHA`, `BSQ_ROTINA_TOKEN` |

**Regra da casa:** segredo de Edge Function é DO PROJETO INTEIRO. Sistema novo
aqui dentro SEMPRE prefixa os seus (`XXX_TOKEN`) — gravar `TOKEN` de novo
derruba a Domo.

## O que foi feito (e como refazer, se um dia precisar)

1. **Tabelas**: `supabase/migrations/0001_init.sql` (tudo `bsq_*`,
   `if not exists`, RLS ligada sem policy; bucket `bsq-arquivos`).
   Rodado via uma function temporária `bsq-setup` (já apagada) que executa SQL
   pela env automática `SUPABASE_DB_URL` — útil quando não há como rodar SQL
   de fora sem a senha do banco.
2. **Functions**: `supabase functions deploy bsq-nucleo bsq-acervo bsq-p
   bsq-rotina --project-ref reoghclxripktzpdwhiy --no-verify-jwt --use-api`
   (a CLI em `~/apps/node20/bin` está logada; `--use-api` dispensa Docker).
3. **Segredos**: `supabase secrets set BSQ_TOKEN=… BSQ_PAINEL_SENHA=…
   BSQ_ROTINA_TOKEN=…` (cópias locais fora do git em `seed/.senha-inicial` e
   `seed/.rotina-token`).
4. **Importação**: `./scripts/atualizar-da-planilha.sh` — 860 registros;
   agosto conferido no centavo contra o Totalizador (41.734,33 / 45.339,05 /
   −3.604,72).
5. **Cron**: job `bsq-rotina-diaria` às 06:10 UTC (03:10 em Montes Claros),
   10 min depois do da Domo. Backup do dia testado na mão: 860 registros.
6. **Site**: GitHub Pages do repo `bosques` (branch `main`, raiz).

## A prova das portas (refazer depois de qualquer mexida em auth)

| chamada | esperado |
|---|---|
| `ping` com `x-token` certo | 200 `{"ok":true}` |
| qualquer coisa sem `x-token` | 401 |
| `snapshot` sem `x-senha` | 403 |
| `snapshot` com senha errada | 403 |

## Lembretes de publicação do front

- Subir `CACHE` do `sw.js` e `VERSAO` do `config.js` a cada deploy.
- `seed/` NUNCA entra no git (CPF de cliente; repo é público).
