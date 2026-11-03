-- Cópia consistente no próprio banco: não transfere milhares de registros
-- pela Edge Function nem depende do limite de paginação do PostgREST.
-- Mantém o formato restaurável e inclui a lixeira e coleções futuras.
create or replace function public.bsq_criar_backup_diario()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_em timestamptz := statement_timestamp();
  v_dia date := (v_em at time zone 'UTC')::date;
  v_resultado jsonb;
begin
  with cfg as (
    select (config - 'senhaHash' - 'espelhoAcesso') || jsonb_build_object(
      'espelhoSenhaConfigurada', coalesce(config #>> '{espelhoAcesso,hash}', '') <> '',
      'usuarios', coalesce((select jsonb_agg(u - 'hash' order by ord)
        from jsonb_array_elements(coalesce(config->'usuarios', '[]'::jsonb)) with ordinality as a(u,ord)), '[]'::jsonb)
    ) as limpa from public.bsq_cfg where id = true
  ), registros as (
    select coalesce(jsonb_agg(registro || jsonb_build_object('_col', colecao) order by colecao,id), '[]'::jsonb) as itens
    from public.bsq_registros where colecao <> '_arqmeta'
  ), arquivos as (
    select coalesce(jsonb_agg(registro order by id), '[]'::jsonb) as itens
    from public.bsq_registros where colecao = '_arqmeta'
  ), seq as (
    select coalesce(jsonb_object_agg('ultimo_' || colecao, jsonb_build_object('n',n)), '{}'::jsonb) as itens
    from public.bsq_seq
  ), salvo as (
    insert into public.bsq_backup(dia, conteudo, em)
    select v_dia, jsonb_build_object('em',v_em,'cfg',cfg.limpa,'registros',registros.itens,
      'seq',seq.itens,'arquivos',arquivos.itens),v_em
    from cfg cross join registros cross join arquivos cross join seq
    on conflict(dia) do update set conteudo=excluded.conteudo,em=excluded.em
    returning dia,em,jsonb_array_length(conteudo->'registros') as registros,
      jsonb_array_length(conteudo->'arquivos') as arquivos
  ) select jsonb_build_object('dia',dia,'em',em,'registros',registros,'arquivos',arquivos)
      into v_resultado from salvo;
  if v_resultado is null then
    raise exception 'Configuração ausente: backup não gravado';
  end if;
  return v_resultado;
end;
$$;
revoke all on function public.bsq_criar_backup_diario() from public,anon,authenticated;
grant execute on function public.bsq_criar_backup_diario() to service_role;
