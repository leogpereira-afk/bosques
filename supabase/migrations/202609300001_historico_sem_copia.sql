-- Histórico dos títulos e movimentos bancários sem cópia idêntica.
--
-- O bsq-omie decidia se o título/movimento mudou comparando JSON.stringify,
-- que depende da ordem das chaves. O jsonb reordena as chaves, então toda
-- rodada (a cada ~11 min) empilhava no histórico uma cópia idêntica: em
-- 30/09/2026 eram 171 mil entradas (só 268 mudanças reais), 125 MB, e a
-- sincronização e o backup passaram a estourar a memória.
--
-- Aplicada direto no projeto em 30/09/2026. A limpeza vem ANTES da trigger:
-- a trigger desfaria a limpeza (ela mantém o histórico quando o original não muda).

-- 1. Limpeza: tira do histórico as entradas cujo original é igual ao estado
--    seguinte (a próxima entrada ou o original atual).
with alvo as (
  select r.colecao, r.id, r.registro
  from public.bsq_registros r
  where r.colecao in ('titulo', 'movbanco')
    and jsonb_array_length(coalesce(r.registro->'historico', '[]'::jsonb)) > 0
),
itens as (
  select a.colecao, a.id, e.val, e.ord,
    coalesce(lead(e.val->'original') over w, a.registro->'original') as proximo
  from alvo a
  cross join lateral jsonb_array_elements(a.registro->'historico') with ordinality as e(val, ord)
  window w as (partition by a.colecao, a.id order by e.ord)
),
limpo as (
  select i.colecao, i.id,
    coalesce(jsonb_agg(i.val order by i.ord) filter (where i.val->'original' is distinct from i.proximo), '[]'::jsonb) as historico,
    count(*) as antes
  from itens i
  group by i.colecao, i.id
)
update public.bsq_registros r
set registro = jsonb_set(r.registro, '{historico}', l.historico)
from limpo l
where r.colecao = l.colecao and r.id = l.id
  and jsonb_array_length(l.historico) < l.antes;

-- 2. Daqui em diante: se o original do Omie não mudou (igualdade de jsonb,
--    que ignora a ordem das chaves), o histórico fica como estava.
create or replace function public.bsq_historico_sem_copia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.registro->'original' = old.registro->'original'
     and (new.registro->'historico') is distinct from (old.registro->'historico') then
    new.registro := jsonb_set(new.registro, '{historico}', coalesce(old.registro->'historico', '[]'::jsonb));
  end if;
  return new;
end
$$;

revoke all on function public.bsq_historico_sem_copia() from public, anon, authenticated;

drop trigger if exists bsq_historico_sem_copia on public.bsq_registros;
create trigger bsq_historico_sem_copia
  before update on public.bsq_registros
  for each row
  when (new.colecao in ('titulo', 'movbanco'))
  execute function public.bsq_historico_sem_copia();
