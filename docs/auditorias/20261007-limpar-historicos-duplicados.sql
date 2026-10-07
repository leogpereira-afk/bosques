-- Remove exclusivamente cópias integrais do mesmo evento de histórico.
-- A cópia anterior dos registros permanece em bsq_meta para recuperação.
WITH atuais AS MATERIALIZED (
  SELECT id,registro FROM public.bsq_registros
  WHERE colecao='venda' AND NOT apagado AND jsonb_typeof(registro->'historico')='array'
  FOR UPDATE
), candidatos AS MATERIALIZED (
  SELECT id,registro,limpo,
    jsonb_array_length(registro->'historico')-jsonb_array_length(limpo) AS removidos
  FROM atuais CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(item ORDER BY primeira),'[]'::jsonb) AS limpo FROM (
      SELECT item,min(ord) AS primeira FROM jsonb_array_elements(registro->'historico')
        WITH ORDINALITY h(item,ord) GROUP BY item
    ) u
  ) d WHERE registro->'historico'<>limpo
), copia AS (
  INSERT INTO public.bsq_meta(chave,valor,atualizado_em)
  SELECT 'auditoria_historicos_duplicados_'||to_char(clock_timestamp(),'YYYYMMDD_HH24MISS_US'),
    jsonb_build_object('em',now(),'por','Auditoria solicitada pelo usuário',
      'escopo','Eventos de histórico idênticos; parcelas e valores preservados',
      'registros',jsonb_agg(jsonb_build_object('colecao','venda','id',id,'registro',registro)),
      'eventosRemovidos',sum(removidos)),now()
  FROM candidatos HAVING count(*)>0 RETURNING chave
), corrigidos AS (
  UPDATE public.bsq_registros r
  SET registro=jsonb_set(c.registro,'{historico}',c.limpo)||
    jsonb_build_object('atualizadoEm',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    atualizado_em=now()
  FROM candidatos c WHERE r.colecao='venda' AND r.id=c.id AND EXISTS(SELECT 1 FROM copia)
  RETURNING c.removidos,
    (r.registro-ARRAY['historico','atualizadoEm'])=(c.registro-ARRAY['historico','atualizadoEm']) AS campos_preservados
), revisao AS (
  UPDATE public.bsq_meta SET valor=jsonb_set(jsonb_set(valor,'{rev}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)::bigint)),
    '{porColecao}',coalesce(valor->'porColecao','{}'::jsonb)||jsonb_build_object('venda',floor(extract(epoch from clock_timestamp())*1000)::bigint)),atualizado_em=now()
  WHERE chave='rev' AND EXISTS(SELECT 1 FROM corrigidos) RETURNING chave
), historico AS (
  INSERT INTO public.bsq_log(entrada)
  SELECT jsonb_build_object('acao','removeu cópias idênticas de eventos de histórico','por','Auditoria solicitada pelo usuário',
    'vendas',count(*),'eventosRemovidos',sum(removidos),'camposFinanceirosPreservados',bool_and(campos_preservados),
    'copiaRecuperacao',(SELECT chave FROM copia)) FROM corrigidos HAVING count(*)>0 RETURNING id
)
SELECT count(*) AS vendas,sum(removidos) AS eventos_removidos,bool_and(campos_preservados) AS outros_campos_preservados,
 (SELECT chave FROM copia) AS copia_recuperacao,(SELECT id FROM historico) AS log_id,(SELECT count(*) FROM revisao) AS revisao_atualizada
FROM corrigidos;
