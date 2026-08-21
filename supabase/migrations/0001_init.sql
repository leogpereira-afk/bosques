-- ============================================================================
-- Schema do Portal dos Bosques (loteadora) no Supabase.
--
-- Mesma fundação da Domo Construtora (provada em produção): cada coleção vive
-- como linhas JSONB numa tabela única de registros; cfg em linha única;
-- numeração atômica; log; backup diário; arquivos no Storage.
--
-- RLS LIGADA EM TUDO E SEM POLICY: só as Edge Functions (service_role, que
-- ignora RLS) tocam nestas tabelas. Ninguém no navegador lê o Postgres direto.
-- ============================================================================

-- ---- registros: o cofre ----------------------------------------------------
create table if not exists public.bsq_registros (
  colecao       text not null,
  id            text not null,
  registro      jsonb not null,
  atualizado_em timestamptz not null default now(),
  apagado       boolean not null default false,
  primary key (colecao, id)
);
create index if not exists bsq_registros_colecao_idx on public.bsq_registros (colecao);
create index if not exists bsq_registros_apagado_idx on public.bsq_registros (apagado) where apagado;
alter table public.bsq_registros enable row level security;

-- ---- cfg: linha única (empresa, reajuste, usuários — hashes NUNCA saem) -----
create table if not exists public.bsq_cfg (
  id            boolean primary key default true check (id),
  config        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.bsq_cfg enable row level security;
insert into public.bsq_cfg (id, config) values (true, '{}'::jsonb) on conflict (id) do nothing;

-- ---- seq: numeração sem duplicata (VD-0001, PR-0001, RB-0001) ---------------
create table if not exists public.bsq_seq (
  colecao text primary key,
  n       integer not null default 0
);
alter table public.bsq_seq enable row level security;

create table if not exists public.bsq_seq_idx (
  colecao text not null,
  numero  integer not null,
  reg_id  text not null,
  primary key (colecao, numero)
);
alter table public.bsq_seq_idx enable row level security;

-- Próximo número de forma ATÔMICA ("lê, soma 1, grava" duplica de verdade).
create or replace function public.bsq_proximo_numero(p_colecao text)
returns integer
language plpgsql
as $$
declare v_n integer;
begin
  insert into public.bsq_seq (colecao, n) values (p_colecao, 1)
  on conflict (colecao) do update set n = public.bsq_seq.n + 1
  returning public.bsq_seq.n into v_n;
  return v_n;
end;
$$;

-- ---- log --------------------------------------------------------------------
create table if not exists public.bsq_log (
  id      bigserial primary key,
  em      timestamptz not null default now(),
  entrada jsonb not null
);
create index if not exists bsq_log_em_idx on public.bsq_log (em desc);
alter table public.bsq_log enable row level security;

-- ---- backup diário ------------------------------------------------------------
create table if not exists public.bsq_backup (
  dia      date primary key,
  conteudo jsonb not null,
  em       timestamptz not null default now()
);
alter table public.bsq_backup enable row level security;

-- ---- meta ----------------------------------------------------------------------
create table if not exists public.bsq_meta (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.bsq_meta enable row level security;

-- ---- Storage: bucket privado (contratos assinados, comprovantes, PDFs) ---------
insert into storage.buckets (id, name, public)
values ('bsq-arquivos', 'bsq-arquivos', false)
on conflict (id) do nothing;
