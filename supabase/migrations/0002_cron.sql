-- ============================================================================
-- Cron diário do Portal dos Bosques: backup, limpeza de log/lixeira/órfãos.
--
-- Preencha os dois valores ANTES de rodar: a URL do projeto e o ROTINA_TOKEN
-- (o mesmo segredo definido nas envs da função bsq-rotina).
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 06:10 UTC = 03:10 em Montes Claros (UTC-3). Madrugada, com o sistema parado.
select cron.schedule(
  'bsq-rotina-diaria',
  '10 6 * * *',
  $$
  select net.http_post(
    url     := 'https://SEU_PROJETO.supabase.co/functions/v1/bsq-rotina',
    headers := jsonb_build_object('content-type', 'application/json', 'x-rotina-token', 'SEU_ROTINA_TOKEN'),
    body    := '{}'::jsonb
  );
  $$
);
