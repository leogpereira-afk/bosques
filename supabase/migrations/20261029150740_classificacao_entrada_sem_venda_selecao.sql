-- Natureza do vínculo confirmada por pessoa: mantém o fato bancário no mesmo rec.
-- Não classifica receita operacional, não cria caixa e não altera a origem Omie.
create or replace function public.bsq_classificar_entrada(p_pedido jsonb,p_por text)
returns jsonb language plpgsql security invoker set search_path=public as $$
<<classificar>>
declare
  rid text; tipo text; motivo text; operacao text; pedido jsonb; repetida record;
  recebido jsonb; fonte jsonb; origem_venda jsonb; tid text; titulo_id text;
  esperado jsonb; versoes jsonb; chave text; stamp text; classificacao jsonb;
  antes jsonb; depois jsonb; hist jsonb; resultado jsonb; colecoes jsonb;
begin
  if jsonb_typeof(p_pedido) is distinct from 'object' then raise exception 'Pedido de classificação inválido'; end if;
  rid=trim(coalesce(p_pedido->>'id',''));tipo=p_pedido->>'tipo';motivo=trim(coalesce(p_pedido->>'motivo',''));operacao=p_pedido->>'operacao';esperado=p_pedido->'esperado';
  if rid='' or length(rid)>100 then raise exception 'Recebimento obrigatório'; end if;
  if tipo is null or tipo not in ('sem_venda','pendente') then raise exception 'Tipo de classificação inválido'; end if;
  if length(motivo)<3 or length(motivo)>300 then raise exception 'Informe o motivo da classificação (3 a 300 caracteres)'; end if;
  if coalesce(length(trim(p_por)),0)=0 then raise exception 'Responsável pela conferência obrigatório'; end if;
  if coalesce(length(operacao),0)<8 or length(operacao)>100 then raise exception 'Identificador da operação inválido'; end if;
  pedido=jsonb_build_object('acao','classificar_entrada','id',rid,'tipo',tipo,'motivo',motivo,'por',p_por);
  perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
  select c.pedido,c.resultado into repetida from public.bsq_conciliacoes c where c.operacao=classificar.operacao;
  if found then
    if repetida.pedido is distinct from pedido then raise exception using errcode='40001',message='Esta operação já foi utilizada para outra conferência'; end if;
    return repetida.resultado||jsonb_build_object('repetida',true);
  end if;
  if jsonb_typeof(esperado) is distinct from 'object' then raise exception using errcode='40001',message='Faltam as versões conferidas. Atualize a tela'; end if;
  select registro into recebido from public.bsq_registros where colecao='rec' and id=rid;
  if recebido is null then raise exception 'Recebimento não encontrado'; end if;
  tid=nullif(recebido->'omie'->>'titulo','');
  if tid is null and rid like 'rbomie-%' then tid=substring(rid from 8); end if;
  titulo_id=case when tid is not null then 'CONTA_A_RECEBER-'||tid else null end;
  perform 1 from public.bsq_registros b where b.colecao='venda'
    or (b.colecao='rec' and (b.id=rid or b.registro->'omie'->>'titulo'=tid or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(b.registro->'alocacoes')='array' then b.registro->'alocacoes' else '[]'::jsonb end) a where a->>'tid'=tid)))
    or (b.colecao='titulo' and b.id=titulo_id) order by b.colecao,b.id for update;
  select registro into recebido from public.bsq_registros where colecao='rec' and id=rid and not coalesce(apagado,false);
  if recebido is null or coalesce(recebido->>'apagadoEm','')<>'' then raise exception 'Recebimento indisponível ou apagado'; end if;
  if coalesce((recebido->>'valor')::numeric,0)<=0 then raise exception 'Recebimento sem valor positivo'; end if;
  if coalesce(recebido->>'data','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Data do recebimento inválida'; end if;
  perform (recebido->>'data')::date;
  if coalesce(recebido->>'vendaId','')<>'' then
    select registro into origem_venda from public.bsq_registros where colecao='venda' and id=recebido->>'vendaId' and not coalesce(apagado,false);
    if origem_venda is null or coalesce(origem_venda->>'apagadoEm','')<>'' or origem_venda->>'situacao' is distinct from 'distratada'
      or coalesce(origem_venda->>'incorporadaEmVendaId','')<>'' then raise exception 'O recebimento possui contrato ativo ou indisponível; confira o vínculo antes de classificar'; end if;
  end if;
  if recebido ? 'alocacoes' and recebido->'alocacoes'<>'null'::jsonb and jsonb_typeof(recebido->'alocacoes')<>'array' then raise exception 'Distribuição inválida; confira as alocações'; end if;
  if exists(select 1 from public.bsq_registros v cross join lateral jsonb_array_elements(coalesce(v.registro->'parcelas','[]')) p
    where v.colecao='venda' and not coalesce(v.apagado,false) and coalesce(v.registro->>'apagadoEm','')=''
      and coalesce(v.registro->>'incorporadaEmVendaId','')='' and coalesce(v.registro->>'situacao','ativa') in ('ativa','conferir','quitada')
      and coalesce(p->>'apagadoEm','')='' and not coalesce((p->>'cancelado')::boolean,false) and not coalesce((p->>'_remover')::boolean,false)
      and (p->>'tid'=tid or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(recebido->'alocacoes')='array' then recebido->'alocacoes' else '[]'::jsonb end) a where a->>'tid'=coalesce(p->>'tid',p->>'id')))) then
    raise exception 'Existe parcela ou alocação em contrato ativo; confira o vínculo antes de classificar';
  end if;
  if tid is not null then
    select registro into fonte from public.bsq_registros where colecao='titulo' and id=titulo_id and not coalesce(apagado,false);
    if fonte is null or coalesce(fonte->>'apagadoEm','')<>'' or fonte->>'grupo' is distinct from 'CONTA_A_RECEBER'
      or coalesce(fonte->>'ausenteOrigemOmie','')<>'' and fonte->'ausenteOrigemOmie'<>'false'::jsonb
      or coalesce((fonte->>'cancelado')::boolean,false) or fonte->>'status'='CANCELADO' then raise exception 'Título de origem indisponível'; end if;
    if fonte->>'titulo' is distinct from tid then raise exception 'Identidade do título diverge do recebimento'; end if;
    if exists(select 1 from public.bsq_registros r where r.colecao='rec' and r.id<>rid and not coalesce(r.apagado,false)
      and coalesce(r.registro->>'apagadoEm','')='' and (r.registro->'omie'->>'titulo'=tid or r.id='rbomie-'||tid
        or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(r.registro->'alocacoes')='array' then r.registro->'alocacoes' else '[]'::jsonb end) a where a->>'tid'=tid))) then
      raise exception 'Mais de um recebimento relacionado ao título; confira os pagamentos antes de classificar';
    end if;
    if exists(select 1 from public.bsq_registros t where t.colecao='titulo' and t.id<>titulo_id and not coalesce(t.apagado,false)
      and t.registro->>'grupo'='CONTA_A_RECEBER' and t.registro->>'titulo'=tid) then raise exception 'Título sem identidade única'; end if;
  end if;
  if tipo='pendente' and recebido->'classificacaoVinculo'->>'tipo' is distinct from 'sem_venda' then raise exception 'Somente uma classificação sem venda confirmada pode ser reaberta'; end if;
  versoes=jsonb_build_object('recebimento',recebido->'atualizadoEm','titulo',fonte->'atualizadoEm');
  for chave in select jsonb_object_keys(versoes) loop
    if not(esperado ? chave) or (esperado->>chave) is distinct from (versoes->>chave) then raise exception using errcode='40001',message='Os dados mudaram durante a conferência. Atualize a tela'; end if;
  end loop;
  stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  classificacao=jsonb_build_object('tipo',tipo,'motivo',motivo,'em',stamp,'por',p_por,'operacao',operacao);
  antes=jsonb_build_object('vendaId',recebido->'vendaId','alocacoes',recebido->'alocacoes','classificacaoVinculo',recebido->'classificacaoVinculo');
  -- Reabrir nunca ressuscita uma venda/alocação anterior; apenas devolve à fila.
  depois=jsonb_build_object('classificacaoVinculo',classificacao,'conferir',tipo='pendente');
  if tipo='sem_venda' then depois=depois||jsonb_build_object('vendaId','','alocacoes','[]'::jsonb,'obsConferir',null); end if;
  hist=jsonb_build_array(jsonb_build_object('id',operacao||':rec:'||rid,'em',stamp,'por',p_por,'acao',case when tipo='sem_venda' then 'confirmou entrada sem vínculo com venda' else 'reabriu classificação do vínculo' end,'motivo',motivo,'antes',antes,'depois',depois));
  update public.bsq_registros set registro=recebido||depois||jsonb_build_object('atualizadoEm',stamp,'atualizadoPor',p_por,'editadoAMao',true,'historico',coalesce(recebido->'historico','[]')||hist),atualizado_em=now() where colecao='rec' and id=rid;
  colecoes='["rec"]'::jsonb;
  if fonte is not null then
    hist=jsonb_build_array(jsonb_build_object('id',operacao||':titulo:'||tid,'em',stamp,'por',p_por,'acao',case when tipo='sem_venda' then 'confirmou título sem vínculo com venda' else 'reabriu classificação do vínculo' end,'motivo',motivo,'recebimentoId',rid,'antes',fonte->'classificacaoVinculo','depois',classificacao));
    update public.bsq_registros set registro=fonte||jsonb_build_object('classificacaoVinculo',classificacao,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(fonte->'historico','[]')||hist),atualizado_em=now() where colecao='titulo' and id=titulo_id;
    colecoes=colecoes||'["titulo"]'::jsonb;
  end if;
  resultado=jsonb_build_object('ok',true,'repetida',false,'colecoes',colecoes,'operacao',operacao,'quando',stamp,'classificacaoVinculo',classificacao);
  update public.bsq_conciliacao_estado set revisao=revisao+1 where id=true;
  insert into public.bsq_conciliacoes(operacao,pedido,resultado,por) values(classificar.operacao,classificar.pedido,classificar.resultado,p_por);
  return resultado;
end $$;
revoke all on function public.bsq_classificar_entrada(jsonb,text) from public,anon,authenticated;
grant execute on function public.bsq_classificar_entrada(jsonb,text) to service_role;

-- Decisão humana explícita (confirmada ou reaberta) não é substituída por associação automática.
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
   and coalesce(registro->'classificacaoVinculo','null'::jsonb)='null'::jsonb
   and not exists(select 1 from bsq_registros r where r.colecao='rec' and r.registro->'omie'->>'titulo'=bsq_registros.registro->>'titulo'
     and coalesce(r.registro->'classificacaoVinculo','null'::jsonb)<>'null'::jsonb)
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
    where b.colecao='venda' and (coalesce(b.registro->>'situacao','')<>'distratada' or b.apagado or regexp_replace(b.registro->>'clienteId','[^0-9]','','g') is distinct from g.cpf or p->>'trava'='true') and exists(select 1 from jsonb_array_elements(g.ts) t where t->>'titulo'=p->>'tid'))
   or exists(select 1 from bsq_registros b where b.colecao='rec' and coalesce(b.registro->>'vendaId','')<>'' and (b.registro->>'editadoAMao'='true' or not exists(select 1 from bsq_registros antiga where antiga.colecao='venda' and antiga.id=b.registro->>'vendaId' and not antiga.apagado and antiga.registro->>'situacao'='distratada' and regexp_replace(antiga.registro->>'clienteId','[^0-9]','','g')=g.cpf))
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
  -- Documento aponta o lote novo; histórico distratado do mesmo cliente é preservado.
  update bsq_registros b set registro=b.registro||jsonb_build_object(
    'parcelas',(select coalesce(jsonb_agg(p),'[]') from jsonb_array_elements(b.registro->'parcelas') p
      where not exists(select 1 from jsonb_array_elements(g.ts) t where t->>'titulo'=p->>'tid')),
    'historico',coalesce(b.registro->'historico','[]')||jsonb_build_array(jsonb_build_object('em',stamp,'por','omie',
      'acao','Títulos transferidos para a venda identificada no documento Omie','destino',vid,'documento',g.doc,
      'parcelasAnteriores',b.registro->'parcelas')),'atualizadoEm',stamp),atualizado_em=now()
   where b.colecao='venda' and b.id<>vid and b.registro->>'situacao'='distratada'
    and exists(select 1 from jsonb_array_elements(coalesce(b.registro->'parcelas','[]')) p
      join jsonb_array_elements(g.ts) t on t->>'titulo'=p->>'tid');
  update bsq_registros b set registro=b.registro||jsonb_build_object('vendaId',vid,'conferir',false,
    'alocacoes',jsonb_build_array(jsonb_build_object('tid',b.registro->'omie'->>'titulo','valor',(b.registro->>'valor')::numeric)),
    'atualizadoEm',stamp,'historico',coalesce(b.registro->'historico','[]')||jsonb_build_array(jsonb_build_object('em',stamp,'por','omie','acao','Pagamento associado pelo documento do lote'))),atualizado_em=now()
   where b.colecao='rec' and not b.apagado and (coalesce(b.registro->>'vendaId','')='' or exists(select 1 from bsq_registros antiga where antiga.colecao='venda' and antiga.id=b.registro->>'vendaId' and not antiga.apagado and antiga.registro->>'situacao'='distratada' and regexp_replace(antiga.registro->>'clienteId','[^0-9]','','g')=g.cpf))
    and exists(select 1 from jsonb_array_elements(g.ts) t where t->>'titulo'=b.registro->'omie'->>'titulo');
  get diagnostics afetados=row_count; vinculados=vinculados+afetados;novas=novas+1;
 end loop;
 return jsonb_build_object('vendasNovas',novas,'pagamentosVinculados',vinculados,'pendenciasVendas',pendencias);
end $$;
revoke all on function public.bsq_importar_vendas_omie() from public,anon,authenticated;
grant execute on function public.bsq_importar_vendas_omie() to service_role;


-- Decisão humana explícita (confirmada ou reaberta) não é substituída por associação automática.
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
   and coalesce(b.registro->'classificacaoVinculo','null'::jsonb)='null'::jsonb
   and not exists(select 1 from bsq_registros r where r.colecao='rec' and r.registro->'omie'->>'titulo'=b.registro->>'titulo'
     and coalesce(r.registro->'classificacaoVinculo','null'::jsonb)<>'null'::jsonb)
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
   where v.colecao='venda' and not v.apagado and coalesce(v.registro->>'situacao','')<>'distratada' and coalesce(v.registro->>'incorporadaEmVendaId','')=''
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


-- Decisão humana explícita (confirmada ou reaberta) não é substituída por associação automática.
-- Corrige o timeout: extrai os campos das vendas uma vez, preservando os mesmos critérios e pós-condições.
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
 ), vendas_destino as materialized (
  select id,regexp_replace(coalesce(registro->>'clienteId',''),'[^0-9]','','g') cpf,
   ltrim(registro->>'quadra','0') quadra,ltrim(registro->>'lote','0') lote
  from bsq_registros where colecao='venda' and not apagado and coalesce(registro->>'situacao','')<>'distratada' and coalesce(registro->>'incorporadaEmVendaId','')=''
 ), fontes as materialized (
  select jsonb_build_object('titulo',b.registro->'titulo','cpf',b.registro->'cpf','venc',b.registro->'venc','valor',b.registro->'valor',
    'original',jsonb_build_object('resumo',b.registro->'original'->'resumo')) t,
   upper(regexp_replace(coalesce(b.registro->'original'->'detalhes'->>'cNumTitulo',''),'\s','','g')) doc
  from bsq_registros b where b.colecao='titulo' and not b.apagado
   and coalesce(b.registro->'classificacaoVinculo','null'::jsonb)='null'::jsonb
   and not exists(select 1 from bsq_registros r where r.colecao='rec' and r.registro->'omie'->>'titulo'=b.registro->>'titulo'
     and coalesce(r.registro->'classificacaoVinculo','null'::jsonb)<>'null'::jsonb)
   and b.registro->>'grupo'='CONTA_A_RECEBER' and coalesce(b.registro->>'status','')<>'CANCELADO'
 ), destinos as materialized (
  select f.*,d.ids from fontes f cross join lateral (
   select array_agg(v.id) ids from vendas_destino v where v.cpf=f.t->>'cpf'
    and v.quadra=ltrim(substring(f.doc from '^Q([0-9]+)'),'0')
    and v.lote=ltrim(substring(f.doc from 'L([0-9]+)$'),'0')
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
