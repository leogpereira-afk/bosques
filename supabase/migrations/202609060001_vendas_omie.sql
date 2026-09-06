-- Importa vendas identificadas explicitamente por documento QxxLyy e cliente.
-- Pagamentos continuam sendo os registros originais: nenhum valor é recriado.
create or replace function public.bsq_importar_vendas_omie()
returns jsonb language plpgsql security invoker set search_path=public as $$
declare g record; l jsonb; c jsonb; v jsonb; ps jsonb; stamp text; vid text; n integer;
 novas integer:=0; vinculados integer:=0; afetados integer; pendencias jsonb:='[]';
begin
 perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
 stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 for g in
  select upper(regexp_replace(registro->'original'->'detalhes'->>'cNumTitulo','\s','','g')) doc,
   count(distinct registro->>'cpf') clientes,min(registro->>'cpf') cpf,
   jsonb_agg(registro order by registro->>'venc',id) ts
  from bsq_registros where colecao='titulo' and not apagado
   and registro->>'grupo'='CONTA_A_RECEBER' and coalesce(registro->>'status','')<>'CANCELADO'
  group by 1 order by 1
 loop
  if g.doc is null then continue; end if;
  if g.doc ~ '^Q[0-9]+L[0-9]+(E[0-9]+)+$' and exists(
   select 1 from bsq_registros b where b.colecao='lote' and not b.apagado
    and (b.registro->>'quadra')::int=substring(g.doc from '^Q([0-9]+)')::int
    and (b.registro->>'lote')::int=any(string_to_array(substring(g.doc from 'L(.*)$'),'E')::int[])
    and b.registro->>'status'='Disponível') then
   pendencias=pendencias||jsonb_build_array(jsonb_build_object('documento',g.doc,'motivo','Venda conjunta: conferir os lotes sem duplicar os valores'));
  end if;
  if g.doc !~ '^Q[0-9]+L[0-9]+$' then continue; end if;
  select registro into l from bsq_registros where colecao='lote' and not apagado
   and (registro->>'quadra')::int=substring(g.doc from '^Q([0-9]+)')::int
   and (registro->>'lote')::int=substring(g.doc from 'L([0-9]+)$')::int for update;
  if l is null then continue; end if;
  -- Não reabre distrato/lixeira nem substitui venda ou reserva cadastrada.
  if exists(select 1 from bsq_registros where colecao='venda' and registro->>'loteId'=l->>'id')
   or coalesce(l->>'vendaId','')<>'' or coalesce(l->>'reservadoPor','')<>'' then continue; end if;
  if g.clientes<>1 or coalesce(g.cpf,'')='' then
   pendencias=pendencias||jsonb_build_array(jsonb_build_object('documento',g.doc,'motivo','Cliente ambíguo'));continue;
  end if;
  select registro into c from bsq_registros where colecao='cliente' and not apagado
   and regexp_replace(coalesce(registro->>'cpf',id),'[^0-9]','','g')=g.cpf limit 1;
  if c is null then
   pendencias=pendencias||jsonb_build_array(jsonb_build_object('documento',g.doc,'motivo','Cadastro do cliente ainda não importado'));continue;
  end if;
  if exists(select 1 from bsq_registros b cross join lateral jsonb_array_elements(coalesce(b.registro->'parcelas','[]')) p
    where b.colecao='venda' and exists(select 1 from jsonb_array_elements(g.ts) t where t->>'titulo'=p->>'tid'))
   or exists(select 1 from bsq_registros b where b.colecao='rec' and coalesce(b.registro->>'vendaId','')<>''
    and exists(select 1 from jsonb_array_elements(g.ts) t where t->>'titulo'=b.registro->'omie'->>'titulo')) then
   pendencias=pendencias||jsonb_build_array(jsonb_build_object('documento',g.doc,'motivo','Título ou pagamento já associado a outra venda'));continue;
  end if;
  select jsonb_agg(jsonb_build_object('tid',t->>'titulo','venc',t->>'venc','valor',(t->>'valor')::numeric,
    'valorDia',(t->>'valor')::numeric,'descontoConfirmado',false,'origem','omie','conferir',false,
    'liquidacao',jsonb_build_object('desconto',coalesce(t->'original'->'resumo'->'nDesconto','0'),
     'juros',coalesce(t->'original'->'resumo'->'nJuros','0'),'multa',coalesce(t->'original'->'resumo'->'nMulta','0'),
     'saldoOrigem',t->'original'->'resumo'->'nValAberto')) order by t->>'venc',t->>'titulo') into ps from jsonb_array_elements(g.ts) t;
  vid='venda-omie-'||(l->>'id'); n=bsq_proximo_numero('venda');
  v=jsonb_build_object('id',vid,'numero',n,'codigo','VD-'||lpad(n::text,4,'0'),'loteId',l->>'id',
    'quadra',l->'quadra','lote',l->'lote','clienteId',c->>'id','clienteNome',c->>'nome','situacao','ativa',
    'entrada',0,'parcelas',ps,'origem','omie','omieDocumento',g.doc,'criadoEm',stamp,'atualizadoEm',stamp,'criadoPor','omie','atualizadoPor','omie',
    'obs','Venda importada dos títulos do Omie. Valores e vencimentos conforme a origem.',
    'historico',jsonb_build_array(jsonb_build_object('em',stamp,'por','omie','acao','Venda identificada pelo documento e cliente','documento',g.doc)));
  insert into bsq_registros(colecao,id,registro,atualizado_em,apagado) values('venda',vid,v,now(),false);
  insert into bsq_seq_idx(colecao,numero,reg_id) values('venda',n,vid);
  update bsq_registros set registro=registro||jsonb_build_object('status','Vendido','vendaId',vid,'atualizadoEm',stamp),atualizado_em=now() where colecao='lote' and id=l->>'id';
  update bsq_registros b set registro=b.registro||jsonb_build_object('vendaId',vid,'conferir',false,
    'alocacoes',jsonb_build_array(jsonb_build_object('tid',b.registro->'omie'->>'titulo','valor',(b.registro->>'valor')::numeric)),
    'atualizadoEm',stamp,'historico',coalesce(b.registro->'historico','[]')||jsonb_build_array(jsonb_build_object('em',stamp,'por','omie','acao','Pagamento associado pelo documento do lote'))),atualizado_em=now()
   where b.colecao='rec' and not b.apagado and coalesce(b.registro->>'vendaId','')=''
    and exists(select 1 from jsonb_array_elements(g.ts) t where t->>'titulo'=b.registro->'omie'->>'titulo');
  get diagnostics afetados=row_count; vinculados=vinculados+afetados;novas=novas+1;
 end loop;
 return jsonb_build_object('vendasNovas',novas,'pagamentosVinculados',vinculados,'pendenciasVendas',pendencias);
end $$;
revoke all on function public.bsq_importar_vendas_omie() from public,anon,authenticated;
grant execute on function public.bsq_importar_vendas_omie() to service_role;
