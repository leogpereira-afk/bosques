DO $teste$
DECLARE alvo record; n_antes integer; n_depois integer; parcelas_antes integer; valor_antes numeric; parcelas_depois integer; valor_depois numeric;
BEGIN
  SELECT v.id, p->>'tid' AS tid INTO alvo
  FROM public.bsq_registros v
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.registro->'parcelas','[]'::jsonb)) p
  JOIN public.bsq_registros t ON t.colecao='titulo' AND t.registro->>'titulo'=p->>'tid' AND t.registro->>'grupo'='CONTA_A_RECEBER'
  WHERE v.colecao='venda' AND NOT v.apagado AND coalesce(v.registro->>'situacao','')<>'distratada'
    AND coalesce((t.registro->>'cancelado')::boolean,false)=false AND coalesce(t.registro->>'status','')<>'CANCELADO'
    AND regexp_replace(coalesce(v.registro->>'clienteId',''),'[^0-9]','','g')=t.registro->>'cpf'
  ORDER BY v.id LIMIT 1;
  IF alvo.id IS NULL THEN RAISE EXCEPTION 'Teste sem venda elegível'; END IF;
  SELECT count(*) INTO n_antes FROM public.bsq_registros v CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.registro->'historico','[]')) h
    WHERE v.colecao='venda' AND v.id=alvo.id AND h->>'por'='Verificação técnica temporária';
  SELECT count(*),sum((p->>'valor')::numeric) INTO parcelas_antes,valor_antes FROM public.bsq_registros v
    CROSS JOIN LATERAL jsonb_array_elements(v.registro->'parcelas') p WHERE v.colecao='venda' AND v.id=alvo.id;
  BEGIN
    PERFORM public.bsq_vincular_titulo(alvo.tid,alvo.id,'Verificação técnica temporária','Teste de evento único; transação sempre revertida');
    SELECT count(*) INTO n_depois FROM public.bsq_registros v CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.registro->'historico','[]')) h
      WHERE v.colecao='venda' AND v.id=alvo.id AND h->>'por'='Verificação técnica temporária';
    SELECT count(*),sum((p->>'valor')::numeric) INTO parcelas_depois,valor_depois FROM public.bsq_registros v
      CROSS JOIN LATERAL jsonb_array_elements(v.registro->'parcelas') p WHERE v.colecao='venda' AND v.id=alvo.id;
    IF n_depois-n_antes<>1 THEN RAISE EXCEPTION 'Regressão: esperava 1 evento, recebeu %',n_depois-n_antes; END IF;
    IF parcelas_antes<>parcelas_depois OR valor_antes IS DISTINCT FROM valor_depois THEN RAISE EXCEPTION 'Parcelas ou valores alterados'; END IF;
    RAISE EXCEPTION USING ERRCODE='ZT001', MESSAGE='Reverter integralmente os efeitos do teste';
  EXCEPTION WHEN SQLSTATE 'ZT001' THEN NULL;
  END;
END $teste$;
SELECT 'PASSOU: um único evento; quantidade e soma das parcelas preservadas; efeitos do teste revertidos' AS resultado;
