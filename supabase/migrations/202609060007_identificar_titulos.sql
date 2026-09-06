-- Confirma também os títulos futuros pelo documento exato + cliente.
-- Uma escrita por venda, com cópia privada anterior; não altera a origem Omie.
create or replace function public.bsq_identificar_titulos_omie(p_aplicar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare mapa jsonb; detalhes jsonb; linha record; novas jsonb; itens jsonb; stamp text;
 qtd integer; vendas integer; pagamentos integer; backup jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
 perform id from bsq_registros where colecao in ('venda','rec') order by colecao,id for update;
 with parcelas as materialized (
  select v.id venda,v.apagado,v.registro->>'situacao' situacao,
   regexp_replace(coalesce(v.registro->>'clienteId',''),'[^0-9]','','g') cpf,p
  from bsq_registros v cross join lateral jsonb_array_elements(coalesce(v.registro->'parcelas','[]')) p where v.colecao='venda'
 ), fontes as materialized (
  select jsonb_build_object('titulo',b.registro->'titulo','cpf',b.registro->'cpf','venc',b.registro->'venc','valor',b.registro->'valor',
    'original',jsonb_build_object('resumo',b.registro->'original'->'resumo')) t,
   upper(regexp_replace(coalesce(b.registro->'original'->'detalhes'->>'cNumTitulo',''),'\s','','g')) doc
  from bsq_registros b where b.colecao='titulo' and not b.apagado
   and b.registro->>'grupo'='CONTA_A_RECEBER' and coalesce(b.registro->>'status','')<>'CANCELADO'
 ), destinos as materialized (
  select f.*,d.ids from fontes f cross join lateral (
   select array_agg(v.id) ids from bsq_registros v where v.colecao='venda' and not v.apagado
    and coalesce(v.registro->>'situacao','')<>'distratada'
    and regexp_replace(coalesce(v.registro->>'clienteId',''),'[^0-9]','','g')=f.t->>'cpf'
    and ltrim(v.registro->>'quadra','0')=ltrim(substring(f.doc from '^Q([0-9]+)'),'0')
    and ltrim(v.registro->>'lote','0')=ltrim(substring(f.doc from 'L([0-9]+)$'),'0')
  ) d where f.doc ~ '^Q[0-9]+L[0-9]+$' and coalesce(f.t->>'cpf','')<>''
 ), impedidos as materialized (
  select distinct p.p->>'tid' tid from parcelas p join fontes f on p.p->>'tid'=f.t->>'titulo' where
    (p.apagado or p.situacao='distratada' or p.cpf<>f.t->>'cpf' or coalesce((p.p->>'cancelado')::boolean,false)
     or coalesce((p.p->>'trava')::boolean,false) or coalesce((p.p->>'vinculoConfirmado')::boolean,false)
     or not coalesce((p.p->>'conferir')::boolean,false))
 ), seguros as (
  select t,doc,ids[1] destino from destinos d where array_length(ids,1)=1
   and not exists(select 1 from impedidos p where p.tid=d.t->>'titulo')
   and not exists(select 1 from bsq_registros r where r.colecao='rec' and r.registro->'omie'->>'titulo'=d.t->>'titulo'
    and (r.apagado or coalesce(r.registro->>'vendaId','') not in ('',ids[1]) or jsonb_array_length(coalesce(r.registro->'alocacoes','[]'))>0))
 ) select coalesce(jsonb_object_agg(t->>'titulo',jsonb_build_object('destino',destino,'documento',doc,'fonte',t)),'{}'),
  count(*)::int,count(distinct destino)::int into mapa,qtd,vendas from seguros;
 select count(*)::int into pagamentos from bsq_registros r where r.colecao='rec' and not r.apagado and mapa ? (r.registro->'omie'->>'titulo');
 select coalesce(jsonb_agg(jsonb_build_object('titulo',key,'venda',value->>'destino','documento',value->>'documento') order by key),'[]') into detalhes from jsonb_each(mapa);
 if p_aplicar and qtd>0 then
  stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select jsonb_agg(jsonb_build_object('colecao',b.colecao,'id',b.id,'registro',b.registro)) into backup from bsq_registros b
   where (b.colecao='rec' and mapa ? (b.registro->'omie'->>'titulo')) or (b.colecao='venda' and
    (exists(select 1 from jsonb_each(mapa) m where m.value->>'destino'=b.id) or
     exists(select 1 from jsonb_array_elements(coalesce(b.registro->'parcelas','[]')) p where mapa ? (p->>'tid'))));
  insert into bsq_auditoria_vinculos(titulo,destino,motivo,antes)
   values('*','vendas','Documento exato e cliente único: '||qtd||' títulos; confirmação em lote',backup);
  for linha in select id,registro from bsq_registros where colecao='venda' and not apagado order by id loop
   if not exists(select 1 from jsonb_each(mapa) m where m.value->>'destino'=linha.id)
    and not exists(select 1 from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where mapa ? (p->>'tid')) then continue; end if;
   select coalesce(jsonb_agg(p),'[]') into novas from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where not (mapa ? coalesce(p->>'tid',''));
   select coalesce(jsonb_agg(jsonb_build_object('tid',m.key,'venc',m.value->'fonte'->>'venc',
     'valor',m.value->'fonte'->'valor','valorDia',m.value->'fonte'->'valor','origem','omie',
     'descontoConfirmado',false,'conferir',false,'vinculoConfirmado',true,
     'vinculoDocumento',m.value->>'documento','vinculoPor','Documento e cliente no Omie',
     'liquidacao',jsonb_build_object('saldoOrigem',m.value->'fonte'->'original'->'resumo'->'nValAberto',
      'desconto',coalesce(m.value->'fonte'->'original'->'resumo'->'nDesconto','0'),
      'juros',coalesce(m.value->'fonte'->'original'->'resumo'->'nJuros','0'),
      'multa',coalesce(m.value->'fonte'->'original'->'resumo'->'nMulta','0')))
    order by m.value->'fonte'->>'venc',m.key),'[]') into itens from jsonb_each(mapa) m where m.value->>'destino'=linha.id;
   update bsq_registros set registro=linha.registro||jsonb_build_object('parcelas',novas||itens,'atualizadoEm',stamp,
     'historico',coalesce(linha.registro->'historico','[]')||jsonb_build_array(jsonb_build_object('em',stamp,'por','omie',
      'acao','Conferência de títulos por documento e cliente','titulos',
      (select jsonb_agg(jsonb_build_object('titulo',key,'destino',value->>'destino','documento',value->>'documento')) from jsonb_each(mapa) where value->>'destino'=linha.id or exists(select 1 from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where p->>'tid'=key)))))
    ,atualizado_em=now() where colecao='venda' and id=linha.id;
  end loop;
  update bsq_registros r set registro=r.registro||jsonb_build_object('vendaId',mapa->(r.registro->'omie'->>'titulo')->>'destino',
    'conferir',false,'alocacoes',jsonb_build_array(jsonb_build_object('tid',r.registro->'omie'->>'titulo','valor',r.registro->'valor')),
    'atualizadoEm',stamp,'historico',coalesce(r.registro->'historico','[]')||jsonb_build_array(jsonb_build_object('em',stamp,'por','omie','acao','Pagamento associado pelo documento e cliente do título'))),atualizado_em=now()
   where r.colecao='rec' and not r.apagado and mapa ? (r.registro->'omie'->>'titulo');
  -- Pós-condições transacionais: qualquer falha reverte o lote inteiro.
  -- Cada título deve existir UMA vez, exclusivamente na venda aprovada.
  if exists(with locais as (
    select v.id venda,p->>'tid' tid from bsq_registros v
     cross join lateral jsonb_array_elements(coalesce(v.registro->'parcelas','[]')) p where v.colecao='venda'
   ) select 1 from jsonb_each(mapa) m left join locais l on l.tid=m.key
    group by m.key,m.value->>'destino' having count(l.tid)<>1 or min(l.venda)<>m.value->>'destino') then
   raise exception 'Conferência revertida: vínculo ausente, duplicado ou em venda diferente';
  end if;
  if exists(select 1 from jsonb_array_elements(backup) a left join bsq_registros r on r.colecao='rec' and r.id=a->>'id'
    where a->>'colecao'='rec' and (r.id is null or r.registro->>'valor' is distinct from a->'registro'->>'valor'
     or r.registro->>'data' is distinct from a->'registro'->>'data')) then
   raise exception 'Conferência revertida: valor ou data de pagamento alterados';
  end if;
 end if;
 return jsonb_build_object('aplicado',p_aplicar,'titulos',qtd,'vendas',vendas,'pagamentos',pagamentos,'identificados',detalhes);
end $$;
revoke all on function public.bsq_identificar_titulos_omie(boolean) from public,anon,authenticated;
grant execute on function public.bsq_identificar_titulos_omie(boolean) to service_role;
