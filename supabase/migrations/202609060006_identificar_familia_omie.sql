-- Complementa documentos vazios somente pela mesma recorrência e cliente do Omie.
create or replace function public.bsq_identificar_pagamentos_omie(p_aplicar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare t record; dest text; n int; doc_familia text; referencia text; itens jsonb:='[]'; backup jsonb; pagamentos integer:=0;
begin
 perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
 for t in
  select b.registro fonte,b.registro->>'titulo' tid,
    upper(regexp_replace(coalesce(b.registro->'original'->'detalhes'->>'cNumTitulo',''),'\s','','g')) doc
  from bsq_registros b where b.colecao='titulo' and not b.apagado
   and b.registro->>'grupo'='CONTA_A_RECEBER' and coalesce(b.registro->>'status','')<>'CANCELADO'
   and exists(select 1 from bsq_registros r where r.colecao='rec' and not r.apagado
    and r.registro->'omie'->>'titulo'=b.registro->>'titulo' and coalesce(r.registro->>'vendaId','')='')
  order by b.id
 loop
  referencia='Documento informado no título';
  if t.doc='' and coalesce(t.fonte->'original'->'detalhes'->>'nCodTitRepet','0')<>'0' then
   select count(distinct upper(regexp_replace(b.registro->'original'->'detalhes'->>'cNumTitulo','\s','','g'))),
    min(upper(regexp_replace(b.registro->'original'->'detalhes'->>'cNumTitulo','\s','','g'))) into n,doc_familia
    from bsq_registros b where b.colecao='titulo' and not b.apagado and b.registro->>'grupo'='CONTA_A_RECEBER'
     and b.registro->>'cpf'=t.fonte->>'cpf'
     and b.registro->'original'->'detalhes'->>'nCodTitRepet'=t.fonte->'original'->'detalhes'->>'nCodTitRepet'
     and coalesce(b.registro->'original'->'detalhes'->>'cNumTitulo','')<>'';
   if n<>1 then continue;end if;
   t.doc=doc_familia;referencia='Mesma recorrência Omie e cliente, com único documento de lote';
  end if;
  if t.doc !~ '^Q[0-9]+L[0-9]+$' or coalesce(t.fonte->>'cpf','')='' then continue;end if;
  select count(*),min(v.id) into n,dest from bsq_registros v
   where v.colecao='venda' and not v.apagado and coalesce(v.registro->>'situacao','')<>'distratada'
   and regexp_replace(coalesce(v.registro->>'clienteId',''),'[^0-9]','','g')=t.fonte->>'cpf'
   and (v.registro->>'quadra')::int=substring(t.doc from '^Q([0-9]+)')::int
   and (v.registro->>'lote')::int=substring(t.doc from 'L([0-9]+)$')::int;
  if n<>1 then continue;end if;
  -- Nunca substitui outro vínculo confirmado, correção manual ou cliente.
  if exists(select 1 from bsq_registros v cross join lateral jsonb_array_elements(coalesce(v.registro->'parcelas','[]')) p
    where v.colecao='venda' and p->>'tid'=t.tid and
    (v.apagado or coalesce(v.registro->>'situacao','')='distratada' or
     regexp_replace(coalesce(v.registro->>'clienteId',''),'[^0-9]','','g')<>t.fonte->>'cpf' or
     (v.id<>dest and (coalesce((p->>'trava')::boolean,false) or not coalesce((p->>'conferir')::boolean,false))))) then continue;end if;
  if exists(select 1 from bsq_registros r where r.colecao='rec' and r.registro->'omie'->>'titulo'=t.tid
    and (r.apagado or coalesce(r.registro->>'vendaId','') not in ('',dest))) then continue;end if;
  select count(*) into n from bsq_registros r where r.colecao='rec' and not r.apagado and r.registro->'omie'->>'titulo'=t.tid and coalesce(r.registro->>'vendaId','')='';
  itens=itens||jsonb_build_array(jsonb_build_object('titulo',t.tid,'documento',t.doc,'referencia',referencia,'venda',dest,'pagamentos',n));pagamentos=pagamentos+n;
  if p_aplicar then
   select jsonb_agg(jsonb_build_object('colecao',b.colecao,'id',b.id,'registro',b.registro)) into backup
    from bsq_registros b where (b.colecao='rec' and b.registro->'omie'->>'titulo'=t.tid)
     or (b.colecao='venda' and (b.id=dest or exists(select 1 from jsonb_array_elements(coalesce(b.registro->'parcelas','[]')) p where p->>'tid'=t.tid)));
   insert into bsq_auditoria_vinculos(titulo,destino,motivo,antes) values(t.tid,dest,referencia||': '||t.doc||' e cliente coincidem com uma única venda',backup);
   perform bsq_vincular_titulo(t.tid,dest,'Conferência automática Omie',referencia||': '||t.doc||', identificador do título e cliente conferidos; valores preservados');
  end if;
 end loop;
 return jsonb_build_object('aplicado',p_aplicar,'pagamentos',pagamentos,'titulos',jsonb_array_length(itens),'identificados',itens);
end $$;
revoke all on function public.bsq_identificar_pagamentos_omie(boolean) from public,anon,authenticated;
grant execute on function public.bsq_identificar_pagamentos_omie(boolean) to service_role;
