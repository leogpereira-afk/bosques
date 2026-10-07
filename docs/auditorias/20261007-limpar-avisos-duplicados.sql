-- Escopo: remove somente avisos JSONB integralmente idênticos.
-- Não altera títulos, pagamentos, despesas, clientes ou vendas.
-- Guarda a lista original para recuperação e registra a operação no histórico.
BEGIN;
WITH atual AS MATERIALIZED (
  SELECT chave, valor FROM public.bsq_meta
  WHERE chave = 'omie_sync' FOR UPDATE
), unicos AS (
  SELECT item, min(ord) AS primeira_posicao
  FROM atual, LATERAL jsonb_array_elements(atual.valor->'pendencias')
       WITH ORDINALITY AS p(item, ord)
  GROUP BY item
), calculo AS MATERIALIZED (
  SELECT atual.chave, atual.valor,
    COALESCE((SELECT jsonb_agg(item ORDER BY primeira_posicao) FROM unicos), '[]'::jsonb) AS limpos,
    jsonb_array_length(atual.valor->'pendencias') AS antes,
    (SELECT count(*) FROM unicos)::integer AS depois
  FROM atual
), copia AS (
  INSERT INTO public.bsq_meta(chave, valor, atualizado_em)
  SELECT 'auditoria_avisos_duplicados_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS_US'),
    jsonb_build_object('em', now(), 'por', 'Auditoria solicitada pelo usuário',
      'escopo', 'Avisos idênticos; nenhum registro financeiro alterado',
      'antes', antes, 'depois', depois, 'pendenciasOriginais', valor->'pendencias'), now()
  FROM calculo WHERE antes > depois
  RETURNING chave
), corrigido AS (
  UPDATE public.bsq_meta m SET valor = jsonb_set(m.valor, '{pendencias}', c.limpos), atualizado_em = now()
  FROM calculo c WHERE m.chave = c.chave AND c.antes > c.depois AND EXISTS(SELECT 1 FROM copia)
  RETURNING c.antes, c.depois
), historico AS (
  INSERT INTO public.bsq_log(entrada)
  SELECT jsonb_build_object('acao', 'removeu avisos idênticos da integração',
      'por', 'Auditoria solicitada pelo usuário', 'antes', antes, 'depois', depois,
      'removidos', antes - depois, 'copiaRecuperacao', (SELECT chave FROM copia))
  FROM corrigido RETURNING id
)
SELECT c.antes, c.depois, c.antes-c.depois AS avisos_removidos,
  (SELECT chave FROM copia) AS copia_recuperacao, (SELECT id FROM historico) AS log_id
FROM corrigido c;
COMMIT;
