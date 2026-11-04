-- Não contém nem aplica dados reais. Rateio explícito com CAS e ledger idempotente.
create or replace function public.bsq_ratear_contratos(p_pedido jsonb,p_por text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 tid text:=p_pedido->>'titulo'; op text:=p_pedido->>'operacao'; motivo text:=trim(p_pedido->>'motivo');
 fonte jsonb; partes jsonb:=p_pedido->'partes'; esperado jsonb:=p_pedido->'esperado';
 linha record; anterior record; v jsonb; r jsonb; p jsonb; antes jsonb; novo jsonb;
 rateio jsonb; rateio_rec jsonb; parcela jsonb; novas jsonb; hist jsonb; distribuicao jsonb;
 ids text[]; stamp text; total numeric; soma numeric; resultado jsonb; cpf text; n integer; a jsonb;
begin
 if length(coalesce(op,''))<8 or length(op)>100 or length(coalesce(motivo,''))<3 or length(motivo)>300 or trim(coalesce(p_por,''))='' then raise exception 'Operação, motivo e responsável obrigatórios'; end if;
 if jsonb_typeof(partes) is distinct from 'array' or jsonb_array_length(partes)<2 or jsonb_array_length(partes)>30 then raise exception 'Selecione de dois a trinta contratos'; end if;
 if jsonb_typeof(p_pedido->'recebimentos') is distinct from 'array' then raise exception 'Distribuição dos recebimentos obrigatória'; end if;
 perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
 select c.pedido,c.resultado into anterior from bsq_conciliacoes c where c.operacao=op;
 if found then
   if anterior.pedido is distinct from p_pedido||jsonb_build_object('por',p_por) then raise exception using errcode='40001',message='Operação já utilizada para outra decisão'; end if;
   return anterior.resultado||jsonb_build_object('repetida',true);
 end if;
 select array_agg(x->>'vendaId'),sum((x->>'valor')::numeric) into ids,soma from jsonb_array_elements(partes) x;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) or exists(select 1 from jsonb_array_elements(partes) x where coalesce(x->>'vendaId','')='' or jsonb_typeof(x->'valor') is distinct from 'number' or (x->>'valor')::numeric<=0 or round((x->>'valor')::numeric,2)<>(x->>'valor')::numeric) then raise exception 'Contratos repetidos ou valores inválidos'; end if;
 perform 1 from bsq_registros b where b.colecao='venda' or b.colecao='titulo' and b.id='CONTA_A_RECEBER-'||tid or b.colecao='rec' and b.registro->'omie'->>'titulo'=tid order by b.colecao,b.id for update;
 select registro into fonte from bsq_registros where colecao='titulo' and id='CONTA_A_RECEBER-'||tid and not apagado;
 if fonte is null or coalesce(fonte->>'apagadoEm','')<>'' or coalesce((fonte->>'ausenteOrigemOmie')::boolean,false) or coalesce((fonte->>'cancelado')::boolean,false) or fonte->>'status'='CANCELADO' or fonte->'classificacaoVinculo'->>'tipo'='sem_venda' then raise exception 'Título indisponível ou classificado sem venda'; end if;
 if not coalesce(esperado ? 'titulo',false) or esperado->'titulo' is distinct from coalesce(fonte->'atualizadoEm','null') then raise exception using errcode='40001',message='Título mudou; atualize a leitura'; end if;
 cpf=regexp_replace(coalesce(fonte->>'cpf',''),'[^0-9]','','g');total=(fonte->>'valor')::numeric;
 if cpf='' or total<=0 or soma<>total or coalesce(fonte->>'venc','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Confira CPF, vencimento e soma do título'; end if;
 if exists(select 1 from unnest(array['nDesconto','nJuros','nMulta']) k where coalesce((fonte->'original'->'resumo'->>k)::numeric,0)<>0) then raise exception 'Descontos e encargos exigem conferência específica'; end if;
 -- Recebimentos novos/deletados e vendas de origem fora da seleção impedem a gravação.
 if exists(select 1 from bsq_registros b cross join lateral jsonb_array_elements(coalesce(b.registro->'parcelas','[]')) x where b.colecao='venda' and not b.apagado and coalesce(b.registro->>'apagadoEm','')='' and coalesce(b.registro->>'incorporadaEmVendaId','')='' and coalesce(b.registro->>'situacao','ativa') in ('ativa','conferir','quitada') and x->>'tid'=tid and not coalesce((x->>'cancelado')::boolean,false) and not b.id=any(ids)) then raise exception 'Inclua todos os contratos que contêm este título'; end if;
 select count(*) into n from bsq_registros where colecao='rec' and not apagado and coalesce(registro->>'apagadoEm','')='' and registro->'omie'->>'titulo'=tid;
 if n<>jsonb_array_length(p_pedido->'recebimentos') or n<>(select count(distinct x->>'id') from jsonb_array_elements(p_pedido->'recebimentos') x) then raise exception using errcode='40001',message='Os recebimentos mudaram; atualize a leitura'; end if;
 for linha in select * from bsq_registros where colecao='venda' and id=any(ids) order by id loop
   v=linha.registro;
   if linha.apagado or coalesce(v->>'apagadoEm','')<>'' or coalesce(v->>'incorporadaEmVendaId','')<>'' or coalesce(v->>'situacao','ativa') not in ('ativa','conferir','quitada') or regexp_replace(coalesce(v->>'clienteId',''),'[^0-9]','','g')<>cpf then raise exception 'Contrato indisponível ou pertencente a outro CPF'; end if;
   if not coalesce(esperado->'vendas' ? linha.id,false) or esperado->'vendas'->linha.id is distinct from coalesce(v->'atualizadoEm','null') then raise exception using errcode='40001',message='Contrato mudou; atualize a leitura'; end if;
   if not coalesce((v->>'entradaNoEspelho')::boolean,false) and coalesce((v->>'entrada')::numeric,0)>0 then
     if not coalesce(p_pedido->'entradasNoEspelho' ? linha.id,false) or (select (x->>'valor')::numeric from jsonb_array_elements(partes) x where x->>'vendaId'=linha.id)<>(v->>'entrada')::numeric then raise exception 'Confira a entrada fora do espelho antes de ratear'; end if;
     if exists(select 1 from bsq_registros rb where rb.colecao='rec' and not rb.apagado and coalesce(rb.registro->>'apagadoEm','')='' and rb.registro->>'vendaId'=linha.id and rb.registro->>'tipo'='entrada' and rb.registro->'omie'->>'titulo' is distinct from tid) then raise exception 'Outro recebimento de entrada exige conferência'; end if;
   end if;
   for p in select x from jsonb_array_elements(coalesce(v->'parcelas','[]')) x where x->>'tid'=tid loop
     if p->>'venc' is distinct from fonte->>'venc' or (p ? 'valorDia' and p->'valorDia'<>'null' and (p->>'valorDia')::numeric<>(p->>'valor')::numeric) or coalesce((p->>'descontoConfirmado')::boolean,false) or exists(select 1 from unnest(array['desconto','juros','multa']) k where coalesce((p->'liquidacao'->>k)::numeric,0)<>0) then raise exception 'Condições locais divergentes; confira vencimento, descontos e encargos'; end if;
   end loop;
 end loop;
 if (select count(*) from bsq_registros where colecao='venda' and id=any(ids))<>cardinality(ids) then raise exception 'Contrato não encontrado'; end if;
 for linha in select * from bsq_registros where colecao='rec' and not apagado and coalesce(registro->>'apagadoEm','')='' and registro->'omie'->>'titulo'=tid order by id loop
   r=linha.registro;
   if not coalesce(esperado->'recebimentos' ? linha.id,false) or esperado->'recebimentos'->linha.id is distinct from coalesce(r->'atualizadoEm','null') then raise exception using errcode='40001',message='Recebimento mudou; atualize a leitura'; end if;
   select x->'partes' into distribuicao from jsonb_array_elements(p_pedido->'recebimentos') x where x->>'id'=linha.id;
   if jsonb_typeof(distribuicao) is distinct from 'array' or jsonb_array_length(distribuicao)<>cardinality(ids) then raise exception 'Distribua cada recebimento entre os contratos'; end if;
   if (select count(distinct x->>'vendaId') from jsonb_array_elements(distribuicao) x)<>cardinality(ids) or exists(select 1 from jsonb_array_elements(distribuicao) x where not (x->>'vendaId')=any(ids) or coalesce(x->>'vendaId','')='' or jsonb_typeof(x->'valor') is distinct from 'number' or (x->>'valor')::numeric<0 or round((x->>'valor')::numeric,2)<>(x->>'valor')::numeric) or (select sum((x->>'valor')::numeric) from jsonb_array_elements(distribuicao) x)<>(r->>'valor')::numeric then raise exception 'Soma ou contratos inválidos no recebimento'; end if;
   if coalesce(r->>'vendaId','')<>'' and not (r->>'vendaId')=any(ids) or r->'classificacaoVinculo'->>'tipo'='sem_venda' or coalesce(r->>'data','')!~'^\d{4}-\d{2}-\d{2}$' or exists(select 1 from jsonb_array_elements(coalesce(r->'alocacoes','[]')) x where x->>'tid' is distinct from tid) then raise exception 'Recebimento com vínculo ou distribuição incompatível'; end if;
 end loop;
 for p in select x from jsonb_array_elements(partes) x loop
   select coalesce(sum((fatia->>'valor')::numeric),0) into soma from jsonb_array_elements(p_pedido->'recebimentos') recebido_item cross join lateral jsonb_array_elements(recebido_item->'partes') fatia where fatia->>'vendaId'=p->>'vendaId';
   if soma>(p->>'valor')::numeric then raise exception 'Recebimento supera a parte do contrato'; end if;
 end loop;
 stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 rateio=jsonb_build_object('versao',1,'operacao',op,'titulo',tid,'valorTotal',total,'venc',fonte->'venc','partes',partes);
 perform set_config('bsq.rateio_operacao',op,true);
 for linha in select * from bsq_registros where colecao='venda' and id=any(ids) order by id loop
   v=linha.registro;select x into p from jsonb_array_elements(partes) x where x->>'vendaId'=linha.id;
   select x into parcela from jsonb_array_elements(coalesce(v->'parcelas','[]')) x where x->>'tid'=tid limit 1;
   parcela=(coalesce(parcela,'{}')-'pago'-'pagoValor'-'pagoOrigem'-'cancelado'-'_remover'-'apagadoEm')||jsonb_build_object('tid',tid,'origem','omie','valor',p->'valor','valorDia',p->'valor','venc',fonte->'venc','conferir',false,'vinculoConfirmado',true,'trava',true,'rateioVendaId',linha.id,'rateioContratos',rateio,'liquidacao',jsonb_build_object('desconto',0,'juros',0,'multa',0));
   select coalesce(jsonb_agg(x),'[]') into novas from jsonb_array_elements(coalesce(v->'parcelas','[]')) x where x->>'tid' is distinct from tid;
   hist=jsonb_build_object('id',op||':venda:'||linha.id,'em',stamp,'por',p_por,'acao','dividiu título entre contratos separados','motivo',motivo,'antes',jsonb_build_object('parcelas',v->'parcelas','entradaNoEspelho',v->'entradaNoEspelho'),'depois',rateio);
   update bsq_registros set registro=v||(case when coalesce(p_pedido->'entradasNoEspelho' ? linha.id,false) then jsonb_build_object('entradaNoEspelho',true) else '{}'::jsonb end)||jsonb_build_object('parcelas',novas||jsonb_build_array(parcela),'atualizadoEm',stamp,'historico',coalesce(v->'historico','[]')||jsonb_build_array(hist)),atualizado_em=now() where colecao='venda' and id=linha.id;
 end loop;
 for linha in select * from bsq_registros where colecao='rec' and not apagado and coalesce(registro->>'apagadoEm','')='' and registro->'omie'->>'titulo'=tid order by id loop
   r=linha.registro;select x->'partes' into distribuicao from jsonb_array_elements(p_pedido->'recebimentos') x where x->>'id'=linha.id;
   rateio_rec=jsonb_build_object('versao',1,'operacao',op,'titulo',tid,'valorTotal',r->'valor','data',r->'data','partes',distribuicao);
   hist=jsonb_build_object('id',op||':rec:'||linha.id,'em',stamp,'por',p_por,'acao','distribuiu recebimento entre contratos','motivo',motivo,'antes',jsonb_build_object('vendaId',r->'vendaId','alocacoes',r->'alocacoes','rateioContratos',r->'rateioContratos'),'depois',rateio_rec);
   update bsq_registros set registro=(r-'classificacaoVinculo')||jsonb_build_object('vendaId','','alocacoes','[]'::jsonb,'rateioContratos',rateio_rec,'conferir',false,'editadoAMao',true,'atualizadoEm',stamp,'historico',coalesce(r->'historico','[]')||jsonb_build_array(hist)),atualizado_em=now() where colecao='rec' and id=linha.id;
 end loop;
 hist=jsonb_build_object('id',op||':titulo','em',stamp,'por',p_por,'acao','confirmou rateio entre contratos independentes','motivo',motivo,'antes',fonte->'rateioContratos','depois',rateio);
 update bsq_registros set registro=(fonte-'classificacaoVinculo')||jsonb_build_object('rateioContratos',rateio,'atualizadoEm',stamp,'historico',coalesce(fonte->'historico','[]')||jsonb_build_array(hist)),atualizado_em=now() where colecao='titulo' and id='CONTA_A_RECEBER-'||tid;
 update bsq_conciliacao_estado set revisao=revisao+1 where id=true;
 resultado=jsonb_build_object('ok',true,'colecoes',jsonb_build_array('venda','rec','titulo'),'titulo',tid,'contratos',cardinality(ids));
 insert into bsq_conciliacoes(operacao,pedido,resultado,por) values(op,p_pedido||jsonb_build_object('por',p_por),resultado,p_por);
 perform set_config('bsq.rateio_operacao','',true);
 return resultado;
end $$;
revoke all on function public.bsq_ratear_contratos(jsonb,text) from public,anon,authenticated;
grant execute on function public.bsq_ratear_contratos(jsonb,text) to service_role;

-- Telas antigas, agrupamentos e rotinas legadas não desfazem uma divisão explícita.
create or replace function public.bsq_proteger_rateio() returns trigger language plpgsql set search_path=public as $$
declare p jsonb; q jsonb;
begin
 if coalesce(current_setting('bsq.rateio_operacao',true),'')<>'' then return new; end if;
 if tg_op='INSERT' then
   if new.registro ? 'rateioContratos' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(new.registro->'parcelas')='array' then new.registro->'parcelas' else '[]'::jsonb end) x where x ? 'rateioContratos') then raise exception 'Novo rateio exige a rotina de divisão entre contratos'; end if;
   return new;
 end if;
 if tg_op='UPDATE' and ((new.registro ? 'rateioContratos' and not old.registro ? 'rateioContratos') or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(new.registro->'parcelas')='array' then new.registro->'parcelas' else '[]'::jsonb end) x where x ? 'rateioContratos' and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(old.registro->'parcelas')='array' then old.registro->'parcelas' else '[]'::jsonb end) y where y->>'tid'=x->>'tid' and y ? 'rateioContratos'))) then raise exception 'Novo rateio exige a rotina de divisão entre contratos'; end if;
 if old.colecao in ('titulo','rec') and old.registro ? 'rateioContratos' then
   if tg_op='DELETE' or (new.apagado is distinct from old.apagado) or (new.registro->'apagadoEm' is distinct from old.registro->'apagadoEm' and coalesce(new.registro->>'apagadoPor','')<>'omie' and coalesce(old.registro->>'apagadoPor','')<>'omie') or new.registro->'rateioContratos' is distinct from old.registro->'rateioContratos' or old.colecao='rec' and (coalesce(new.registro->>'vendaId','')<>'' or new.registro->'alocacoes' is distinct from old.registro->'alocacoes') then raise exception 'Use a divisão entre contratos para revisar este rateio'; end if;
 end if;
 if old.colecao='venda' then
   for p in select x from jsonb_array_elements(case when jsonb_typeof(old.registro->'parcelas')='array' then old.registro->'parcelas' else '[]'::jsonb end) x where x ? 'rateioContratos' loop
     if tg_op='DELETE' then raise exception 'Contrato possui rateio; preserve seu histórico'; end if;
     select x into q from jsonb_array_elements(case when jsonb_typeof(new.registro->'parcelas')='array' then new.registro->'parcelas' else '[]'::jsonb end) x where x->>'tid'=p->>'tid';
     if q is null or q->'rateioContratos' is distinct from p->'rateioContratos' or q->'valor' is distinct from p->'valor' or q->'venc' is distinct from p->'venc' or q->'rateioVendaId' is distinct from p->'rateioVendaId' or new.registro->'incorporadaEmVendaId' is distinct from old.registro->'incorporadaEmVendaId' then raise exception 'Parcela distribuída: revise pela divisão entre contratos'; end if;
   end loop;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists bsq_proteger_rateio on bsq_registros;
create trigger bsq_proteger_rateio before insert or update or delete on bsq_registros for each row execute function public.bsq_proteger_rateio();
