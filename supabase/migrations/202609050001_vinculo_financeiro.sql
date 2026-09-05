-- Associação explícita de título: venda, parcela e recebimento mudam na mesma transação.
-- Exclusiva do service_role, chamada pela função autenticada bsq-nucleo.
create or replace function public.bsq_vincular_titulo(p_tid text,p_venda text,p_por text,p_motivo text)
returns void language plpgsql security invoker set search_path=public as $$
declare dest jsonb; fonte jsonb; parcela jsonb; existente jsonb; linha record; novas jsonb; stamp text; hist jsonb;
begin
  if length(trim(p_motivo))<3 then raise exception 'Informe o motivo do vínculo'; end if;
  perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
  select registro into dest from bsq_registros where colecao='venda' and id=p_venda for update;
  if dest is null or dest->>'apagadoEm' is not null or dest->>'situacao'='distratada' then raise exception 'Venda de destino indisponível';end if;
  select registro into fonte from bsq_registros where colecao='titulo' and registro->>'titulo'=p_tid and registro->>'grupo'='CONTA_A_RECEBER' limit 1;
  if fonte is not null then
    if coalesce((fonte->>'cancelado')::boolean,false) or fonte->>'status'='CANCELADO' then raise exception 'Título cancelado não pode ser vinculado';end if;
    if regexp_replace(coalesce(dest->>'clienteId',''),'[^0-9]','','g')<>fonte->>'cpf' then raise exception 'O título pertence a outro cliente';end if;
    parcela=jsonb_build_object('tid',p_tid,'venc',fonte->>'venc','valor',(fonte->>'valor')::numeric,'origem','omie','liquidacao',jsonb_build_object('desconto',coalesce(fonte->'original'->'resumo'->'nDesconto','0'::jsonb),'juros',coalesce(fonte->'original'->'resumo'->'nJuros','0'::jsonb),'multa',coalesce(fonte->'original'->'resumo'->'nMulta','0'::jsonb),'saldoOrigem',fonte->'original'->'resumo'->'nValAberto')); 
  end if;
  stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  hist=jsonb_build_array(jsonb_build_object('id',stamp||p_tid,'em',stamp,'por',p_por,'acao','vinculou título','titulo',p_tid,'destino',p_venda,'motivo',p_motivo));
  for linha in select id,registro from bsq_registros where colecao='venda' and registro->>'apagadoEm' is null order by id for update loop
    if exists(select 1 from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where p->>'tid'=p_tid) then
      if regexp_replace(coalesce(linha.registro->>'clienteId',''),'[^0-9]','','g')<>regexp_replace(coalesce(dest->>'clienteId',''),'[^0-9]','','g') then raise exception 'Existe parcela de outro cliente com este identificador';end if;
      select p into existente from jsonb_array_elements(linha.registro->'parcelas') p where p->>'tid'=p_tid limit 1;
      if existente is not null then parcela=coalesce(parcela,'{}'::jsonb)||existente;end if;
      select coalesce(jsonb_agg(p),'[]') into novas from jsonb_array_elements(linha.registro->'parcelas') p where p->>'tid' is distinct from p_tid;
      update bsq_registros set registro=linha.registro||jsonb_build_object('parcelas',novas,'atualizadoEm',stamp,'historico',coalesce(linha.registro->'historico','[]')||hist),atualizado_em=now() where colecao='venda' and id=linha.id;
    end if;
  end loop;
  if parcela is null then raise exception 'Título não encontrado';end if;
  select registro into dest from bsq_registros where colecao='venda' and id=p_venda;
  parcela=parcela||jsonb_build_object('conferir',false,'vinculoConfirmado',true,'trava',true);
  update bsq_registros set registro=dest||jsonb_build_object('parcelas',coalesce(dest->'parcelas','[]')||jsonb_build_array(parcela),'atualizadoEm',stamp,'historico',coalesce(dest->'historico','[]')||hist),atualizado_em=now() where colecao='venda' and id=p_venda;
  update bsq_registros set registro=registro||jsonb_build_object('vendaId',p_venda,'alocacoes',jsonb_build_array(jsonb_build_object('tid',p_tid,'valor',(registro->>'valor')::numeric)),'conferir',false,'editadoAMao',true,'atualizadoEm',stamp,'historico',coalesce(registro->'historico','[]')||hist),atualizado_em=now() where colecao='rec' and registro->'omie'->>'titulo'=p_tid and registro->>'apagadoEm' is null;
end $$;
revoke all on function public.bsq_vincular_titulo(text,text,text,text) from public, anon, authenticated;
grant execute on function public.bsq_vincular_titulo(text,text,text,text) to service_role;
