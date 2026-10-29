-- Unidade financeira conjunta por seleção humana. Sem dados de produção.
create or replace function public.bsq_lote_ids_venda(v jsonb)
returns text[] language sql immutable set search_path=public as $$
  select coalesce(array_agg(distinct id order by id),array[]::text[]) from (
    select x->>'loteId' id from jsonb_array_elements(case when jsonb_typeof(v->'lotes')='array' then v->'lotes' else '[]' end) x
    union select jsonb_array_elements_text(case when jsonb_typeof(v->'loteIds')='array' then v->'loteIds' else '[]' end)
    union select v->>'loteId'
  ) ids where coalesce(id,'')<>'';
$$;

create or replace function public.bsq_agrupar_contratos(p_pedido jsonb,p_por text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  pedido jsonb; anterior record; resultado jsonb; principal text; operacao text; motivo text; politica text; plano jsonb; esperado jsonb;
  ids text[]; recibos_pedidos text[]; titulos_pedidos text[]; recibos text[]:=array[]::text[]; tids text[]:=array[]::text[]; lote_ids text[]:=array[]::text[];
  v jsonb; principal_antes jsonb; fonte jsonb; recebido jsonb; origem_venda jsonb; lote jsonb; novas jsonb; p jsonb; local_p jsonb;
  mapa jsonb:='{}'; manuais jsonb:='{}'; parcelas jsonb:='[]'; lotes jsonb:='[]'; dados_lote jsonb; hist jsonb; depois jsonb;
  versoes jsonb:='{}'; selecionadas jsonb:='{}'; fontes jsonb:='{}'; antes_grupo jsonb:='{}'; stamp text; cpf text; cpf_r text;
  ident text; tid text; lid text; chave text; campo text; linha record; valor numeric; ordinal integer;
begin
  if jsonb_typeof(p_pedido) is distinct from 'object' then raise exception 'Pedido de agrupamento inválido'; end if;
  principal=trim(coalesce(p_pedido->>'principal',''));operacao=p_pedido->>'operacao';motivo=trim(coalesce(p_pedido->>'motivo',''));politica=p_pedido->>'politica';
  plano=p_pedido->'plano';esperado=p_pedido->'esperado';
  if principal='' or length(motivo)<3 or coalesce(length(trim(p_por)),0)=0 then raise exception 'Principal, motivo e responsável obrigatórios'; end if;
  if coalesce(length(operacao),0)<8 or length(operacao)>100 then raise exception 'Identificador da operação inválido'; end if;
  if politica is null or politica not in ('origem','pendente') then raise exception 'Escolha a política das parcelas'; end if;
  if p_pedido->'confirmarPlanoPrincipal' is distinct from 'true'::jsonb or jsonb_typeof(plano) is distinct from 'object' then raise exception 'Confirme expressamente o plano financeiro conjunto'; end if;
  if exists(select 1 from jsonb_object_keys(plano) k where k not in ('entrada','entradaNoEspelho','qtdeParcelas','valorParcela','tipoParcela','inicioParcelas')) then raise exception 'Campo de plano não permitido'; end if;
  foreach campo in array array['entrada','qtdeParcelas','valorParcela'] loop
    if jsonb_typeof(plano->campo) is distinct from 'number' then raise exception 'Valor numérico de plano obrigatório: %',campo; end if;
    valor=(plano->>campo)::numeric;if valor<0 or valor>1000000000 then raise exception 'Valor do plano inválido'; end if;
    if campo='qtdeParcelas' and (valor<>trunc(valor) or valor>10000) then raise exception 'Quantidade de parcelas inválida'; end if;
  end loop;
  if jsonb_typeof(plano->'entradaNoEspelho') is distinct from 'boolean' or coalesce(length(trim(plano->>'tipoParcela')),0)=0 or length(plano->>'tipoParcela')>80 then raise exception 'Condições do plano inválidas'; end if;
  if coalesce(plano->>'inicioParcelas','')<>'' then
    if plano->>'inicioParcelas'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Início das parcelas inválido'; end if;
    perform (plano->>'inicioParcelas')::date;
  end if;
  foreach campo in array array['vendas','recebimentos','titulos'] loop
    if jsonb_typeof(coalesce(p_pedido->campo,'[]')) is distinct from 'array' then raise exception 'Seleção inválida: %',campo; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(p_pedido->campo,'[]')) x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}'))=0 or length(x#>>'{}')>100) then raise exception 'Identificador de seleção inválido'; end if;
    if (select count(*)<>count(distinct x) from jsonb_array_elements_text(coalesce(p_pedido->campo,'[]')) x) then raise exception 'Seleção contém identificador repetido'; end if;
  end loop;
  select coalesce(array_agg(x order by case when x=principal then 0 else 1 end,x),array[]::text[]) into ids from jsonb_array_elements_text(coalesce(p_pedido->'vendas','[]')) x;
  select coalesce(array_agg(x),array[]::text[]) into recibos_pedidos from jsonb_array_elements_text(coalesce(p_pedido->'recebimentos','[]')) x;
  select coalesce(array_agg(x),array[]::text[]) into titulos_pedidos from jsonb_array_elements_text(coalesce(p_pedido->'titulos','[]')) x;
  if not(principal=any(ids)) or cardinality(ids)>100 or cardinality(recibos_pedidos)>10000 or cardinality(titulos_pedidos)>10000 then raise exception 'Inclua o contrato principal na seleção válida'; end if;
  pedido=(p_pedido-'operacao'-'esperado')||jsonb_build_object('tipo','agruparContratos','por',p_por);
  perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
  select c.pedido,c.resultado into anterior from bsq_conciliacoes c where c.operacao=p_pedido->>'operacao';
  if found then
    if anterior.pedido is distinct from pedido then raise exception using errcode='40001',message='Operação já utilizada para outro pedido'; end if;
    return anterior.resultado||jsonb_build_object('repetida',true);
  end if;
  if jsonb_typeof(esperado) is distinct from 'object' then raise exception using errcode='40001',message='Faltam versões conferidas'; end if;
  -- Impede uma inserção legada de recebimento durante a descoberta do conjunto.
  -- Leitores continuam livres; esta operação rara retém o lock só na transação.
  lock table bsq_registros in share row exclusive mode;
  stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  foreach ident in array ids loop
    select registro into v from bsq_registros where colecao='venda' and id=ident and not coalesce(apagado,false);
    if v is null or coalesce(v->>'apagadoEm','')<>'' or coalesce(v->>'situacao','ativa') not in ('ativa','conferir','quitada') then raise exception 'Contrato indisponível ou distratado: %',ident; end if;
    if coalesce(v->>'incorporadaEmVendaId','')<>'' then raise exception 'Contrato já incorporado; selecione o principal'; end if;
    if not(coalesce(esperado->'vendas','{}')?ident) or (esperado->'vendas'->>ident) is distinct from (v->>'atualizadoEm') then raise exception using errcode='40001',message='As vendas mudaram. Atualize a conferência'; end if;
    if ident=principal and coalesce(v->>'situacao','ativa') not in ('ativa','conferir') then raise exception 'Escolha como principal um contrato ativa ou em conferência; principal quitada não recebe obrigações abertas'; end if;
    if ident=principal then principal_antes=v;cpf=regexp_replace(coalesce(v->>'clienteId',''),'[^0-9]','','g'); end if;
    if cpf='' or regexp_replace(coalesce(v->>'clienteId',''),'[^0-9]','','g')<>cpf then raise exception 'Os contratos precisam pertencer ao mesmo CPF/CNPJ'; end if;
    selecionadas=selecionadas||jsonb_build_object(ident,v);antes_grupo=antes_grupo||jsonb_build_object(ident,v-'historico');
    if cardinality(bsq_lote_ids_venda(v))=0 then raise exception 'Contrato sem lote'; end if;
    foreach lid in array bsq_lote_ids_venda(v) loop
      if not(lid=any(lote_ids)) then lote_ids=array_append(lote_ids,lid); end if;
    end loop;
    for p in select x from jsonb_array_elements(coalesce(v->'parcelas','[]')) x loop
      if p='null'::jsonb or coalesce((p->>'cancelado')::boolean,false) or coalesce((p->>'_remover')::boolean,false) or coalesce(p->>'apagadoEm','')<>'' then continue; end if;
      tid=p->>'tid';
      if coalesce(tid,'')<>'' and p->>'origem' is distinct from 'manual' then
        if mapa?tid then
          if jsonb_build_array(p->'valorDia',p->'desconto',p->'descontoConfirmado') is distinct from jsonb_build_array(mapa->tid->'valorDia',mapa->tid->'desconto',mapa->tid->'descontoConfirmado') then raise exception 'Descontos ou condições locais divergentes para o mesmo título. Confira as condições antes de agrupar'; end if;
          if politica='pendente' and jsonb_build_array(p->'valor',p->'venc') is distinct from jsonb_build_array(mapa->tid->'valor',mapa->tid->'venc') then raise exception 'Condições locais divergentes. Confira ou escolha expressamente o nominal e vencimento da origem'; end if;
        end if;
        if not(tid=any(tids)) then tids=array_append(tids,tid);mapa=mapa||jsonb_build_object(tid,p); end if;
      else
        chave=coalesce(nullif(p->>'tid',''),p->>'id');
        if coalesce(chave,'')='' or manuais?chave then raise exception 'Parcela local sem identificador único; confira antes de agrupar'; end if;
        manuais=manuais||jsonb_build_object(chave,p);
      end if;
    end loop;
  end loop;
  foreach lid in array lote_ids loop
    select registro into lote from bsq_registros where colecao='lote' and id=lid and not coalesce(apagado,false);
    if lote is null or coalesce(lote->>'apagadoEm','')<>'' then raise exception 'Lote indisponível: %',lid; end if;
    if exists(select 1 from bsq_registros b where b.colecao='venda' and not coalesce(b.apagado,false) and coalesce(b.registro->>'apagadoEm','')='' and coalesce(b.registro->>'incorporadaEmVendaId','')='' and coalesce(b.registro->>'situacao','ativa') in ('ativa','conferir','quitada') and not(b.id=any(ids)) and lid=any(bsq_lote_ids_venda(b.registro))) then raise exception 'O lote tem dono fora dos contratos selecionados'; end if;
    dados_lote=jsonb_build_object('loteId',lid,'quadra',lote->'quadra','lote',lote->'lote','areaM2',lote->'areaM2');lotes=lotes||jsonb_build_array(dados_lote);
  end loop;
  foreach tid in array titulos_pedidos loop if not(tid=any(tids)) then tids=array_append(tids,tid); end if; end loop;
  -- Seleções avulsas são explícitas. Recebimentos de contratos incorporados
  -- acompanham a unidade financeira; nenhum novo fato de caixa é criado.
  for linha in select id,registro,apagado from bsq_registros where colecao='rec' and (id=any(recibos_pedidos) or (not coalesce(apagado,false) and coalesce(registro->>'apagadoEm','')='' and registro->>'vendaId'=any(ids))) order by id loop
    if coalesce(linha.apagado,false) or coalesce(linha.registro->>'apagadoEm','')<>'' then raise exception 'Recebimento apagado ou indisponível'; end if;
    recibos=array_append(recibos,linha.id);tid=linha.registro->'omie'->>'titulo';
    if coalesce(tid,'')<>'' and not(tid=any(tids)) then tids=array_append(tids,tid); end if;
  end loop;
  if exists(select 1 from unnest(recibos_pedidos) id where not(id=any(recibos))) then raise exception 'Recebimento selecionado indisponível'; end if;
  -- Selecionar um título inclui seus recebimentos, como na conciliação simples.
  for linha in select id,registro from bsq_registros where colecao='rec' and not coalesce(apagado,false) and coalesce(registro->>'apagadoEm','')='' and registro->'omie'->>'titulo'=any(tids) order by id loop
    if not(linha.id=any(recibos)) then recibos=array_append(recibos,linha.id); end if;
  end loop;
  foreach tid in array tids loop
    select registro into fonte from bsq_registros where colecao='titulo' and id='CONTA_A_RECEBER-'||tid and not coalesce(apagado,false);
    if fonte is null or coalesce(fonte->>'apagadoEm','')<>'' or fonte->>'grupo' is distinct from 'CONTA_A_RECEBER' or coalesce((fonte->>'cancelado')::boolean,false) or upper(coalesce(fonte->>'status',''))='CANCELADO' or (fonte->'ausenteOrigemOmie' is not null and fonte->'ausenteOrigemOmie' not in ('null'::jsonb,'false'::jsonb)) then raise exception 'Título de origem indisponível: %',tid; end if;
    if fonte->'classificacaoVinculo'->>'tipo'='sem_venda' then raise exception 'Título classificado sem venda; reabra a classificação'; end if;
    if regexp_replace(coalesce(fonte->>'cpf',''),'[^0-9]','','g')<>cpf then raise exception 'Título pertence a outro CPF/CNPJ'; end if;
    if not(coalesce(esperado->'titulos','{}')?tid) or (esperado->'titulos'->>tid) is distinct from (fonte->>'atualizadoEm') then raise exception using errcode='40001',message='Os títulos mudaram. Atualize a conferência'; end if;
    if exists(select 1 from bsq_registros b cross join lateral jsonb_array_elements(coalesce(b.registro->'parcelas','[]')) x where b.colecao='venda' and not coalesce(b.apagado,false) and coalesce(b.registro->>'apagadoEm','')='' and coalesce(b.registro->>'incorporadaEmVendaId','')='' and not(b.id=any(ids)) and x->>'tid'=tid and not coalesce((x->>'cancelado')::boolean,false) and not coalesce((x->>'_remover')::boolean,false)) then raise exception 'O título pertence a outro contrato; inclua a dona na seleção'; end if;
    fontes=fontes||jsonb_build_object(tid,fonte);local_p=mapa->tid;
    p=coalesce(local_p,'{}')||jsonb_build_object('tid',tid,'origem','omie','conferir',politica='pendente','vinculoConfirmado',true,'trava',true,
      'liquidacao',jsonb_build_object('desconto',coalesce(fonte->'original'->'resumo'->'nDesconto','0'::jsonb),'juros',coalesce(fonte->'original'->'resumo'->'nJuros','0'::jsonb),'multa',coalesce(fonte->'original'->'resumo'->'nMulta','0'::jsonb),'saldoOrigem',fonte->'original'->'resumo'->'nValAberto'),
      'conciliacao',jsonb_build_object('operacao',operacao,'politica',politica,'em',stamp,'por',p_por,'motivo',motivo));
    if politica='origem' or local_p is null then p=p||jsonb_build_object('valor',fonte->'valor','venc',fonte->'venc'); end if;
    if politica='origem' then
      if coalesce((p->>'valor')::numeric,0)<=0 or coalesce(p->>'venc','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Valor ou vencimento da origem inválido'; end if;
      perform (p->>'venc')::date;
    end if;
    parcelas=parcelas||jsonb_build_array(p);
  end loop;
  for p in select value from jsonb_each(manuais) loop parcelas=parcelas||jsonb_build_array(p); end loop;
  if plano->'entradaNoEspelho'='true'::jsonb and jsonb_array_length(parcelas)=0 then raise exception 'Entrada no espelho exige parcelas ou títulos'; end if;
  foreach ident in array recibos loop
    select registro into recebido from bsq_registros where colecao='rec' and id=ident;
    if recebido->'classificacaoVinculo'->>'tipo'='sem_venda' then raise exception 'Recebimento classificado sem venda; reabra a classificação'; end if;
    if not(coalesce(esperado->'recebimentos','{}')?ident) or (esperado->'recebimentos'->>ident) is distinct from (recebido->>'atualizadoEm') then raise exception using errcode='40001',message='Os recebimentos mudaram. Atualize a conferência'; end if;
    if coalesce(recebido->>'vendaId','')<>'' and not((recebido->>'vendaId')=any(ids)) then raise exception 'Recebimento pertence a outro contrato; inclua o contrato na seleção'; end if;
    foreach campo in array array['cpf','clienteId'] loop
      cpf_r=regexp_replace(coalesce(recebido->>campo,''),'[^0-9]','','g');if cpf_r<>'' and cpf_r<>cpf then raise exception 'Recebimento pertence a outro CPF/CNPJ'; end if;
    end loop;
    cpf_r=regexp_replace(coalesce(recebido->'omie'->>'cpf',''),'[^0-9]','','g');if cpf_r<>'' and cpf_r<>cpf then raise exception 'Recebimento pertence a outro CPF/CNPJ'; end if;
    if coalesce(recebido->>'vendaId','')='' and coalesce(recebido->'omie'->>'titulo','')='' and regexp_replace(coalesce(recebido->>'cpf','')||coalesce(recebido->>'clienteId','')||coalesce(recebido->'omie'->>'cpf',''),'[^0-9]','','g')='' then raise exception 'Avulso sem CPF verificável; confira a identidade antes de associar'; end if;
    if coalesce((recebido->>'valor')::numeric,0)<=0 then raise exception 'Recebimento sem valor válido'; end if;
    if jsonb_typeof(recebido->'alocacoes')='array' then
      if exists(select 1 from jsonb_array_elements(recebido->'alocacoes') a where coalesce((a->>'valor')::numeric,0)<=0 or not exists(select 1 from jsonb_array_elements(parcelas) x where coalesce(x->>'tid',x->>'id')=a->>'tid')) then raise exception 'Alocação fora das parcelas do contrato conjunto'; end if;
      if (select coalesce(sum((a->>'valor')::numeric),0) from jsonb_array_elements(recebido->'alocacoes') a)>(recebido->>'valor')::numeric then raise exception 'Alocação supera recebimento'; end if;
    end if;
  end loop;
  -- Todas as validações terminaram; daqui em diante a transação escreve o grupo.
  novas=principal_antes||plano||jsonb_build_object('lotes',lotes,'loteIds',to_jsonb(lote_ids),'parcelas',parcelas,
    'agrupamento',jsonb_build_object('operacao',operacao,'vendas',to_jsonb(ids),'motivo',motivo,'em',stamp,'por',p_por),'atualizadoEm',stamp,'atualizadoPor',p_por);
  hist=jsonb_build_object('id',operacao||':venda:'||principal,'em',stamp,'por',p_por,'acao','agrupou contrato e lotes por seleção','motivo',motivo,'antes',antes_grupo,'depois',novas-'historico');
  update bsq_registros set registro=novas||jsonb_build_object('historico',coalesce(principal_antes->'historico','[]')||jsonb_build_array(hist)),atualizado_em=now() where colecao='venda' and id=principal;
  foreach ident in array ids loop
    if ident=principal then continue; end if;v=selecionadas->ident;
    depois=jsonb_build_object('incorporadaEmVendaId',principal,'incorporacao',jsonb_build_object('em',stamp,'por',p_por,'operacao',operacao,'motivo',motivo));
    hist=jsonb_build_object('id',operacao||':venda:'||ident,'em',stamp,'por',p_por,'acao','incorporou cadastro ao contrato conjunto','motivo',motivo,'antes',v-'historico','depois',depois);
    update bsq_registros set registro=v||depois||jsonb_build_object('atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(v->'historico','[]')||jsonb_build_array(hist)),atualizado_em=now() where colecao='venda' and id=ident;
  end loop;
  foreach lid in array lote_ids loop
    select registro into lote from bsq_registros where colecao='lote' and id=lid;
    hist=jsonb_build_object('id',operacao||':lote:'||lid,'em',stamp,'por',p_por,'acao','vinculou lote ao contrato conjunto','motivo',motivo,'antes',jsonb_build_object('vendaId',lote->'vendaId','status',lote->'status'),'depois',jsonb_build_object('vendaId',principal,'status','Vendido'));
    update bsq_registros set registro=lote||jsonb_build_object('vendaId',principal,'status','Vendido','atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(lote->'historico','[]')||jsonb_build_array(hist)),atualizado_em=now() where colecao='lote' and id=lid;
  end loop;
  foreach ident in array recibos loop
    select registro into recebido from bsq_registros where colecao='rec' and id=ident;
    depois=jsonb_build_object('vendaId',principal);tid=recebido->'omie'->>'titulo';
    if coalesce(tid,'')<>'' and (recebido->'alocacoes' is null or recebido->'alocacoes'='null'::jsonb or recebido->'alocacoes'='[]'::jsonb) then depois=depois||jsonb_build_object('alocacoes',jsonb_build_array(jsonb_build_object('tid',tid,'valor',recebido->'valor'))); end if;
    hist=jsonb_build_object('id',operacao||':rec:'||ident,'em',stamp,'por',p_por,'acao','associou recebimento ao contrato conjunto','motivo',motivo,'antes',jsonb_build_object('vendaId',recebido->'vendaId','alocacoes',recebido->'alocacoes','classificacaoVinculo',recebido->'classificacaoVinculo'),'depois',depois);
    update bsq_registros set registro=(recebido-'classificacaoVinculo')||depois||jsonb_build_object('editadoAMao',true,'conferir',(select coalesce(sum((a->>'valor')::numeric),0) from jsonb_array_elements(coalesce(depois->'alocacoes',nullif(recebido->'alocacoes','null'::jsonb),'[]')) a)<>(recebido->>'valor')::numeric,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(recebido->'historico','[]')||jsonb_build_array(hist)),atualizado_em=now() where colecao='rec' and id=ident;
  end loop;
  foreach tid in array tids loop
    fonte=fontes->tid;depois=jsonb_build_object('vendaId',principal,'politica',politica,'operacao',operacao,'em',stamp,'por',p_por);
    hist=jsonb_build_object('id',operacao||':titulo:'||tid,'em',stamp,'por',p_por,'acao','associou título ao contrato conjunto','motivo',motivo,'antes',jsonb_build_object('conciliacao',fonte->'conciliacao','classificacaoVinculo',fonte->'classificacaoVinculo'),'depois',depois);
    update bsq_registros set registro=(fonte-'classificacaoVinculo')||jsonb_build_object('conciliacao',depois,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(fonte->'historico','[]')||jsonb_build_array(hist)),atualizado_em=now() where colecao='titulo' and id='CONTA_A_RECEBER-'||tid;
  end loop;
  resultado=jsonb_build_object('ok',true,'repetida',false,'principal',principal,'lotes',cardinality(lote_ids),'recebimentos',cardinality(recibos),'titulos',cardinality(tids),'colecoes',jsonb_build_array('venda','lote','titulo','rec'),'operacao',operacao,'quando',stamp);
  update bsq_conciliacao_estado set revisao=revisao+1 where id=true;
  insert into bsq_conciliacoes(operacao,pedido,resultado,por) values(operacao,pedido,resultado,p_por);
  return resultado;
end $$;
revoke all on function public.bsq_agrupar_contratos(jsonb,text) from public,anon,authenticated;
grant execute on function public.bsq_agrupar_contratos(jsonb,text) to service_role;

-- Caminhos humanos anteriores respeitam o contrato conjunto e a classificação.
create or replace function public.bsq_conciliar_financeiro(
  p_tipo text, p_id text, p_destino text, p_politica text, p_decisao text,
  p_manual text, p_motivo text, p_por text, p_operacao text, p_esperado jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  pedido jsonb; anterior record; resultado jsonb; fonte jsonb; dest jsonb;
  recebido jsonb; manual jsonb; copia jsonb; origem_venda jsonb;
  parcela jsonb; local_parcela jsonb; linha record; novas jsonb; hist jsonb;
  versoes jsonb; chave text; stamp text; ident text; cpf text; cpf_destino text;
  alocacoes jsonb; alocado numeric; valor_pago numeric; valor_manual numeric;
  colecoes jsonb; antes jsonb; depois jsonb; locais_destino integer; locais_total integer:=0;
begin
  if p_tipo is null or p_tipo not in ('titulo','recebimento','duplicidade') then raise exception 'Tipo de conciliação inválido'; end if;
  if coalesce(length(trim(p_id)),0)=0 then raise exception 'Registro da conciliação obrigatório'; end if;
  if coalesce(length(trim(p_motivo)),0)<3 then raise exception 'Informe o motivo e o documento conferido'; end if;
  if coalesce(length(trim(p_por)),0)=0 then raise exception 'Responsável pela conferência obrigatório'; end if;
  if coalesce(length(p_operacao),0)<8 or length(p_operacao)>100 then raise exception 'Identificador da operação inválido'; end if;
  pedido=jsonb_build_object('tipo',p_tipo,'id',p_id,'destino',coalesce(p_destino,''),'politica',coalesce(p_politica,''),'decisao',coalesce(p_decisao,''),'manual',coalesce(p_manual,''),'motivo',trim(p_motivo),'por',p_por);
  -- Mesmo domínio da associação anterior. A sincronização Omie precisa
  -- preservar estes campos ao gravar; este lock não substitui essa proteção.
  perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
  select c.pedido,c.resultado into anterior from public.bsq_conciliacoes c where c.operacao=p_operacao;
  if found then
    if anterior.pedido is distinct from pedido then raise exception using errcode='40001',message='Esta operação já foi utilizada para outra conferência. Atualize a tela'; end if;
    return anterior.resultado||jsonb_build_object('repetida',true);
  end if;
  if jsonb_typeof(p_esperado) is distinct from 'object' then raise exception using errcode='40001',message='Faltam as versões conferidas. Atualize a tela'; end if;

  -- Ordem estável das linhas envolvidas; toda a confirmação é uma transação.
  perform 1 from public.bsq_registros b where
    (b.colecao='venda' and p_tipo in ('titulo','recebimento')) or
    (b.colecao='titulo' and b.id=(case when p_tipo='duplicidade' then 'CONTA_A_PAGAR-' else 'CONTA_A_RECEBER-' end)||p_id) or
    (b.colecao='rec' and ((p_tipo='recebimento' and b.id=p_id) or (p_tipo='titulo' and b.registro->'omie'->>'titulo'=p_id))) or
    (b.colecao='cx' and p_tipo='duplicidade' and (b.id=p_manual or b.id='cxomie-'||p_id or b.registro->'omie'->>'titulo'=p_id))
    order by b.colecao,b.id for update;
  stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if p_tipo in ('titulo','recebimento') then
    select registro into dest from public.bsq_registros where colecao='venda' and id=p_destino and not coalesce(apagado,false);
    if dest is null or coalesce(dest->>'incorporadaEmVendaId','')<>'' or coalesce(dest->>'apagadoEm','')<>'' or coalesce(dest->>'situacao','ativa') not in ('ativa','conferir','quitada') then raise exception 'Contrato de destino indisponível, cancelado ou distratado'; end if;
    cpf_destino=regexp_replace(coalesce(dest->>'clienteId',''),'[^0-9]','','g');
    if p_tipo='titulo' then
      select registro into fonte from public.bsq_registros where colecao='titulo' and id='CONTA_A_RECEBER-'||p_id and not coalesce(apagado,false);
      if fonte is null or coalesce(fonte->>'apagadoEm','')<>'' or fonte->>'grupo' is distinct from 'CONTA_A_RECEBER' then raise exception 'Título a receber não encontrado'; end if;
      if coalesce((fonte->>'cancelado')::boolean,false) or upper(coalesce(fonte->>'status',''))='CANCELADO' then raise exception 'Título cancelado não pode ser vinculado'; end if;
      if fonte->'classificacaoVinculo'->>'tipo'='sem_venda' then raise exception 'Título classificado sem venda; reabra a conferência'; end if;
      if fonte->'ausenteOrigemOmie' is not null and fonte->'ausenteOrigemOmie' not in ('null'::jsonb,'false'::jsonb) then raise exception 'Título indisponível na origem'; end if;
      cpf=regexp_replace(coalesce(fonte->>'cpf',''),'[^0-9]','','g');
      if cpf='' or cpf_destino='' or cpf<>cpf_destino then raise exception 'O título pertence a outro cliente ou está sem CPF verificável'; end if;
      versoes=jsonb_build_object('titulo',fonte->'atualizadoEm','venda',dest->'atualizadoEm');
    else
      select registro into recebido from public.bsq_registros where colecao='rec' and id=p_id and not coalesce(apagado,false);
      if recebido is null or coalesce(recebido->>'apagadoEm','')<>'' then raise exception 'Recebimento não encontrado ou indisponível'; end if;
      if recebido->'classificacaoVinculo'->>'tipo'='sem_venda' then raise exception 'Recebimento classificado sem venda; reabra a conferência'; end if;
      if coalesce(recebido->'omie'->>'titulo','')<>'' then raise exception 'Confira o título Omie para mover a parcela e o recebimento juntos'; end if;
      if coalesce((recebido->>'valor')::numeric,0)<=0 then raise exception 'Recebimento sem valor válido'; end if;
      versoes=jsonb_build_object('recebimento',recebido->'atualizadoEm','venda',dest->'atualizadoEm');
      select registro into origem_venda from public.bsq_registros where colecao='venda' and id=recebido->>'vendaId';
      -- Um manual sem identidade anterior permite escolha humana explícita;
      -- qualquer identidade já conhecida precisa corresponder ao destino.
      foreach chave in array array['cpf','clienteId'] loop
        cpf=regexp_replace(coalesce(recebido->>chave,''),'[^0-9]','','g');
        if cpf<>'' and cpf is distinct from cpf_destino then raise exception 'O recebimento pertence a outro cliente (CPF)'; end if;
      end loop;
      cpf=regexp_replace(coalesce(nullif(recebido->'omie'->>'cpf',''),origem_venda->>'clienteId',''),'[^0-9]','','g');
      if cpf<>'' and cpf is distinct from cpf_destino then raise exception 'O recebimento pertence a outro cliente (CPF)'; end if;
    end if;
  else
    select registro into fonte from public.bsq_registros where colecao='titulo' and id='CONTA_A_PAGAR-'||p_id and not coalesce(apagado,false);
    if fonte is null or coalesce(fonte->>'apagadoEm','')<>'' or fonte->>'grupo' is distinct from 'CONTA_A_PAGAR' then raise exception 'Título a pagar não encontrado'; end if;
    if coalesce((fonte->>'cancelado')::boolean,false) or upper(coalesce(fonte->>'status',''))='CANCELADO' then raise exception 'Título cancelado não pode ser conciliado'; end if;
    if p_decisao is null or p_decisao not in ('mesmo','distintos') then raise exception 'Decisão da duplicidade inválida'; end if;
    versoes=jsonb_build_object('titulo',fonte->'atualizadoEm');
    if p_decisao='mesmo' then
      if coalesce(p_manual,'')='' then raise exception 'Selecione o lançamento manual conferido'; end if;
      select registro into manual from public.bsq_registros where colecao='cx' and id=p_manual and not coalesce(apagado,false);
      if manual is null or coalesce(manual->>'apagadoEm','')<>'' or manual->>'tipo' is distinct from 'saida' or p_manual='cxomie-'||p_id then raise exception 'Lançamento manual indisponível'; end if;
      versoes=versoes||jsonb_build_object('manual',manual->'atualizadoEm');
    end if;
  end if;
  -- Chave ausente não equivale a uma versão legado explicitamente nula.
  for chave in select jsonb_object_keys(versoes) loop
    if not(p_esperado ? chave) or (p_esperado->>chave) is distinct from (versoes->>chave) then raise exception using errcode='40001',message='Os dados mudaram durante a conferência. Atualize a tela e confira novamente'; end if;
  end loop;

  if p_tipo='titulo' then
    if p_politica is null or p_politica not in ('origem','local','pendente') then raise exception 'Escolha a política de valor e vencimento'; end if;
    select count(*) into locais_destino from jsonb_array_elements(coalesce(dest->'parcelas','[]')) p where p->>'tid'=p_id;
    select p into local_parcela from jsonb_array_elements(coalesce(dest->'parcelas','[]')) p where p->>'tid'=p_id limit 1;
    for linha in select id,registro from public.bsq_registros where colecao='venda' and not coalesce(apagado,false) and coalesce(registro->>'apagadoEm','')='' and coalesce(registro->>'incorporadaEmVendaId','')='' order by id loop
      if exists(select 1 from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where p->>'tid'=p_id) then
        locais_total=locais_total+(select count(*) from jsonb_array_elements(linha.registro->'parcelas') p where p->>'tid'=p_id);
        if regexp_replace(coalesce(linha.registro->>'clienteId',''),'[^0-9]','','g')<>cpf_destino then raise exception 'Existe parcela de outro cliente com este identificador'; end if;
        if coalesce(linha.registro->>'situacao','ativa') not in ('ativa','conferir','quitada') then raise exception 'A parcela está em contrato indisponível, cancelado ou distratado'; end if;
        if local_parcela is null then select p into local_parcela from jsonb_array_elements(linha.registro->'parcelas') p where p->>'tid'=p_id limit 1; end if;
      end if;
    end loop;
    if p_politica='local' and local_parcela is null then raise exception 'Não há parcela local para manter'; end if;
    if p_politica='local' and not(locais_destino=1 or (locais_destino=0 and locais_total=1)) then raise exception 'Há mais de uma fonte local para esta parcela. Escolha um contrato com uma única parcela correspondente ou mantenha os valores em conferência'; end if;
    parcela=coalesce(local_parcela,jsonb_build_object('valor',fonte->'valor','venc',fonte->'venc'))||jsonb_build_object('tid',p_id,'origem','omie');
    if p_politica='origem' then parcela=parcela||jsonb_build_object('valor',fonte->'valor','venc',fonte->'venc'); end if;
    if p_politica<>'pendente' and (coalesce((parcela->>'valor')::numeric,0)<=0 or coalesce(parcela->>'venc','')!~'^\d{4}-\d{2}-\d{2}$') then raise exception 'Confira o valor e o vencimento antes de concluir'; end if;
    if p_politica<>'pendente' then perform (parcela->>'venc')::date; end if;
    parcela=parcela||jsonb_build_object('conferir',p_politica='pendente','vinculoConfirmado',true,'trava',true,
      'liquidacao',jsonb_build_object('desconto',coalesce(fonte->'original'->'resumo'->'nDesconto','0'::jsonb),'juros',coalesce(fonte->'original'->'resumo'->'nJuros','0'::jsonb),'multa',coalesce(fonte->'original'->'resumo'->'nMulta','0'::jsonb),'saldoOrigem',fonte->'original'->'resumo'->'nValAberto'),
      'conciliacao',jsonb_build_object('operacao',p_operacao,'politica',p_politica,'em',stamp,'por',p_por,'motivo',trim(p_motivo),'valorOrigem',fonte->'valor','vencOrigem',fonte->'venc','valorLocalAntes',local_parcela->'valor','vencLocalAntes',local_parcela->'venc'));
    for linha in select id,registro from public.bsq_registros where colecao='venda' and not coalesce(apagado,false) and coalesce(registro->>'apagadoEm','')='' and coalesce(registro->>'incorporadaEmVendaId','')='' order by id loop
      if linha.id=p_destino or exists(select 1 from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where p->>'tid'=p_id) then
        select coalesce(jsonb_agg(p),'[]') into novas from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where p->>'tid' is distinct from p_id;
        if linha.id=p_destino then novas=novas||jsonb_build_array(parcela); end if;
        select coalesce(jsonb_agg(p),'[]') into antes from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where p->>'tid'=p_id;
        depois=case when linha.id=p_destino then jsonb_build_array(parcela) else '[]'::jsonb end;
        hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':venda:'||linha.id,'em',stamp,'por',p_por,'acao','conciliou vínculo do título','titulo',p_id,'destino',p_destino,'politica',p_politica,'motivo',trim(p_motivo),'antes',jsonb_build_object('vendaId',linha.id,'parcelas',antes),'depois',jsonb_build_object('vendaId',linha.id,'parcelas',depois)));
        update public.bsq_registros set registro=linha.registro||jsonb_build_object('parcelas',novas,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(linha.registro->'historico','[]')||hist),atualizado_em=now() where colecao='venda' and id=linha.id;
      end if;
    end loop;
    for linha in select id,registro from public.bsq_registros where colecao='rec' and not coalesce(apagado,false) and coalesce(registro->>'apagadoEm','')='' and registro->'omie'->>'titulo'=p_id loop
      if linha.registro->'classificacaoVinculo'->>'tipo'='sem_venda' then raise exception 'Recebimento classificado sem venda; reabra a conferência'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(linha.registro->'alocacoes','[]')) a where a->>'tid' is distinct from p_id) then raise exception 'O recebimento foi distribuído em outras parcelas. Confira a distribuição antes de mudar o contrato'; end if;
      alocacoes=jsonb_build_array(jsonb_build_object('tid',p_id,'valor',linha.registro->'valor'));
      antes=jsonb_build_object('vendaId',linha.registro->'vendaId','alocacoes',linha.registro->'alocacoes','classificacaoVinculo',linha.registro->'classificacaoVinculo');
      depois=jsonb_build_object('vendaId',p_destino,'alocacoes',alocacoes);
      hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':rec:'||linha.id,'em',stamp,'por',p_por,'acao','conciliou recebimento do título','titulo',p_id,'motivo',trim(p_motivo),'antes',antes,'depois',depois));
      update public.bsq_registros set registro=(linha.registro-'classificacaoVinculo')||depois||jsonb_build_object('conferir',false,'editadoAMao',true,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(linha.registro->'historico','[]')||hist),atualizado_em=now() where colecao='rec' and id=linha.id;
    end loop;
    -- A versão do título também muda: protege duas conferências simultâneas
    -- que escolhem destinos diferentes e cujas vendas ainda não mudaram.
    hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':titulo:'||p_id,'em',stamp,'por',p_por,'acao','confirmou contrato do título','destino',p_destino,'politica',p_politica,'motivo',trim(p_motivo),'antes',fonte->'conciliacao','classificacaoAntes',fonte->'classificacaoVinculo'));
    update public.bsq_registros set registro=(fonte-'classificacaoVinculo')||jsonb_build_object('conciliacao',jsonb_build_object('operacao',p_operacao,'vendaId',p_destino,'politica',p_politica,'em',stamp,'por',p_por),'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(fonte->'historico','[]')||hist),atualizado_em=now() where colecao='titulo' and id='CONTA_A_RECEBER-'||p_id;
    colecoes='["titulo","venda","rec"]';
  elsif p_tipo='recebimento' then
    alocacoes='[]'; alocado=0;
    if recebido->>'vendaId'=p_destino then
      alocacoes=coalesce(recebido->'alocacoes','[]');
      if exists(select 1 from jsonb_array_elements(alocacoes) a where coalesce((a->>'valor')::numeric,0)<=0 or not exists(select 1 from jsonb_array_elements(coalesce(dest->'parcelas','[]')) p where coalesce(p->>'tid',p->>'id')=a->>'tid' and not coalesce((p->>'cancelado')::boolean,false))) then raise exception 'Distribuição inválida: confira as parcelas do contrato'; end if;
      if exists(select a->>'tid' from jsonb_array_elements(alocacoes) a group by a->>'tid' having count(*)>1) then raise exception 'A distribuição contém parcela repetida'; end if;
      select coalesce(sum((a->>'valor')::numeric),0) into alocado from jsonb_array_elements(alocacoes) a;
      if round(alocado*100)>round((recebido->>'valor')::numeric*100) then raise exception 'A distribuição supera o valor recebido'; end if;
    end if;
    antes=jsonb_build_object('vendaId',recebido->'vendaId','alocacoes',recebido->'alocacoes','classificacaoVinculo',recebido->'classificacaoVinculo');
    depois=jsonb_build_object('vendaId',p_destino,'alocacoes',alocacoes,'conferir',round(alocado*100)<>round((recebido->>'valor')::numeric*100));
    hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':rec:'||p_id,'em',stamp,'por',p_por,'acao','conciliou contrato do recebimento','motivo',trim(p_motivo),'antes',antes,'depois',depois));
    update public.bsq_registros set registro=(recebido-'classificacaoVinculo')||depois||jsonb_build_object('editadoAMao',true,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(recebido->'historico','[]')||hist),atualizado_em=now() where colecao='rec' and id=p_id;
    colecoes='["rec"]';
  else
    if fonte->>'decisaoDuplicidade'='mesmo' and p_decisao='distintos' then raise exception using errcode='40001',message='Este título já está associado a um pagamento. Confira e desfaça o vínculo explicitamente antes de mudar a decisão'; end if;
    if p_decisao='mesmo' then
      valor_pago=round(coalesce((fonte->'original'->'resumo'->>'nValLiquido')::numeric,
        coalesce((fonte->'original'->'resumo'->>'nValPago')::numeric,0)-coalesce((fonte->'original'->'resumo'->>'nDesconto')::numeric,0)+coalesce((fonte->'original'->'resumo'->>'nJuros')::numeric,0)+coalesce((fonte->'original'->'resumo'->>'nMulta')::numeric,0))*100);
      valor_manual=round(coalesce((manual->>'valor')::numeric,0)*100);
      if valor_pago<=0 or valor_manual<>valor_pago then raise exception 'O valor do lançamento manual não confere com o pagamento do título'; end if;
      if coalesce(manual->'omie'->>'titulo','') not in ('',p_id) then raise exception using errcode='40001',message='Lançamento manual já vinculado a outro título'; end if;
      if exists(select 1 from public.bsq_registros where colecao='cx' and id not in (p_manual,'cxomie-'||p_id) and not coalesce(apagado,false) and coalesce(registro->>'apagadoEm','')='' and registro->'omie'->>'titulo'=p_id) then raise exception using errcode='40001',message='Este título já está vinculado a outro lançamento. Atualize a conferência'; end if;
      hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':manual:'||p_manual,'em',stamp,'por',p_por,'acao','confirmou mesmo pagamento Omie','titulo',p_id,'motivo',trim(p_motivo),'antes',jsonb_build_object('omie',manual->'omie'),'depois',jsonb_build_object('titulo',p_id)));
      update public.bsq_registros set registro=manual||jsonb_build_object('vinculoOmieConfirmado',true,'omie',coalesce(manual->'omie','{}')||jsonb_build_object('titulo',p_id,'original',fonte->'original'),'editadoAMao',true,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(manual->'historico','[]')||hist),atualizado_em=now() where colecao='cx' and id=p_manual;
      select registro into copia from public.bsq_registros where colecao='cx' and id='cxomie-'||p_id and not coalesce(apagado,false);
      if copia is not null and coalesce(copia->>'apagadoEm','')='' then
        if copia->>'origem' is distinct from 'omie' or copia->'omie'->>'titulo' is distinct from p_id or round(coalesce((copia->>'valor')::numeric,0)*100)<>valor_pago then raise exception using errcode='40001',message='A cópia importada mudou. Atualize e confira antes de conciliá-la'; end if;
        hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':copia:'||p_id,'em',stamp,'por',p_por,'acao','cópia importada enviada à lixeira após confirmar mesmo pagamento','manualId',p_manual,'motivo',trim(p_motivo)));
        update public.bsq_registros set registro=copia||jsonb_build_object('apagadoEm',stamp,'apagadoPor',p_por,'substituidoPor',p_manual,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(copia->'historico','[]')||hist),apagado=true,atualizado_em=now() where colecao='cx' and id='cxomie-'||p_id;
      end if;
    end if;
    hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':titulo:'||p_id,'em',stamp,'por',p_por,'acao','conferiu duplicidade','decisao',p_decisao,'manualId',nullif(p_manual,''),'motivo',trim(p_motivo),'antes',fonte->'decisaoDuplicidade'));
    update public.bsq_registros set registro=fonte||jsonb_build_object('decisaoDuplicidade',p_decisao,'manualConciliadoId',case when p_decisao='mesmo' then p_manual else null end,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(fonte->'historico','[]')||hist),atualizado_em=now() where colecao='titulo' and id='CONTA_A_PAGAR-'||p_id;
    colecoes='["titulo","cx"]';
  end if;
  resultado=jsonb_build_object('ok',true,'repetida',false,'colecoes',colecoes,'operacao',p_operacao,'quando',stamp);
  update public.bsq_conciliacao_estado set revisao=revisao+1 where id=true;
  insert into public.bsq_conciliacoes(operacao,pedido,resultado,por) values(p_operacao,pedido,resultado,p_por);
  return resultado;
end $$;
revoke all on function public.bsq_conciliar_financeiro(text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.bsq_conciliar_financeiro(text,text,text,text,text,text,text,text,text,jsonb) to service_role;

-- Corrige o registro em dobro quando origem e destino são a mesma venda.
-- Associação explícita de título: venda, parcela e recebimento mudam na mesma transação.
-- Exclusiva do service_role, chamada pela função autenticada bsq-nucleo.
create or replace function public.bsq_vincular_titulo(p_tid text,p_venda text,p_por text,p_motivo text)
returns void language plpgsql security invoker set search_path=public as $$
declare dest jsonb; fonte jsonb; parcela jsonb; existente jsonb; linha record; novas jsonb; stamp text; hist jsonb;
begin
  if length(trim(p_motivo))<3 then raise exception 'Informe o motivo do vínculo'; end if;
  perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
  if exists(select 1 from bsq_registros r cross join lateral jsonb_array_elements(coalesce(r.registro->'alocacoes','[]')) a where r.colecao='rec' and not coalesce(r.apagado,false) and coalesce(r.registro->>'apagadoEm','')='' and r.registro->'omie'->>'titulo'=p_tid and a->>'tid' is distinct from p_tid) then raise exception 'O recebimento foi distribuído em outras parcelas. Confira a distribuição antes de mudar o contrato'; end if;
  select registro into dest from bsq_registros where colecao='venda' and id=p_venda for update;
  if dest is null or coalesce(dest->>'incorporadaEmVendaId','')<>'' or dest->>'apagadoEm' is not null or dest->>'situacao'='distratada' then raise exception 'Venda de destino indisponível';end if;
  select registro into fonte from bsq_registros where colecao='titulo' and registro->>'titulo'=p_tid and registro->>'grupo'='CONTA_A_RECEBER' limit 1;
  if fonte->'classificacaoVinculo'->>'tipo'='sem_venda' or exists(select 1 from bsq_registros where colecao='rec' and not coalesce(apagado,false) and registro->>'apagadoEm' is null and registro->'omie'->>'titulo'=p_tid and registro->'classificacaoVinculo'->>'tipo'='sem_venda') then raise exception 'Título ou recebimento classificado sem venda; reabra a conferência'; end if;
  if coalesce(fonte->>'apagadoEm','')<>'' or (fonte->'ausenteOrigemOmie' is not null and fonte->'ausenteOrigemOmie' not in ('null'::jsonb,'false'::jsonb)) then raise exception 'Título indisponível na origem'; end if;
  if fonte is not null then
    if coalesce((fonte->>'cancelado')::boolean,false) or fonte->>'status'='CANCELADO' then raise exception 'Título cancelado não pode ser vinculado';end if;
    if regexp_replace(coalesce(dest->>'clienteId',''),'[^0-9]','','g')<>fonte->>'cpf' then raise exception 'O título pertence a outro cliente';end if;
    parcela=jsonb_build_object('tid',p_tid,'venc',fonte->>'venc','valor',(fonte->>'valor')::numeric,'origem','omie','liquidacao',jsonb_build_object('desconto',coalesce(fonte->'original'->'resumo'->'nDesconto','0'::jsonb),'juros',coalesce(fonte->'original'->'resumo'->'nJuros','0'::jsonb),'multa',coalesce(fonte->'original'->'resumo'->'nMulta','0'::jsonb),'saldoOrigem',fonte->'original'->'resumo'->'nValAberto'));
  end if;
  stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  hist=jsonb_build_array(jsonb_build_object('id',stamp||p_tid,'em',stamp,'por',p_por,'acao','vinculou título','titulo',p_tid,'destino',p_venda,'motivo',p_motivo));
  for linha in select id,registro from bsq_registros where colecao='venda' and not coalesce(apagado,false) and registro->>'apagadoEm' is null and coalesce(registro->>'incorporadaEmVendaId','')='' order by id for update loop
    if exists(select 1 from jsonb_array_elements(coalesce(linha.registro->'parcelas','[]')) p where p->>'tid'=p_tid) then
      if regexp_replace(coalesce(linha.registro->>'clienteId',''),'[^0-9]','','g')<>regexp_replace(coalesce(dest->>'clienteId',''),'[^0-9]','','g') then raise exception 'Existe parcela de outro cliente com este identificador';end if;
      select p into existente from jsonb_array_elements(linha.registro->'parcelas') p where p->>'tid'=p_tid limit 1;
      if existente is not null then parcela=coalesce(parcela,'{}'::jsonb)||existente;end if;
      select coalesce(jsonb_agg(p),'[]') into novas from jsonb_array_elements(linha.registro->'parcelas') p where p->>'tid' is distinct from p_tid;
      update bsq_registros set registro=linha.registro||jsonb_build_object('parcelas',novas,'atualizadoEm',stamp,'historico',coalesce(linha.registro->'historico','[]')||case when linha.id=p_venda then '[]'::jsonb else hist end),atualizado_em=now() where colecao='venda' and id=linha.id;
    end if;
  end loop;
  if parcela is null then raise exception 'Título não encontrado';end if;
  select registro into dest from bsq_registros where colecao='venda' and id=p_venda;
  parcela=parcela||jsonb_build_object('conferir',false,'vinculoConfirmado',true,'trava',true);
  update bsq_registros set registro=dest||jsonb_build_object('parcelas',coalesce(dest->'parcelas','[]')||jsonb_build_array(parcela),'atualizadoEm',stamp,'historico',coalesce(dest->'historico','[]')||hist),atualizado_em=now() where colecao='venda' and id=p_venda;
  update bsq_registros set registro=(registro-'classificacaoVinculo')||jsonb_build_object('vendaId',p_venda,'alocacoes',jsonb_build_array(jsonb_build_object('tid',p_tid,'valor',(registro->>'valor')::numeric)),'conferir',false,'editadoAMao',true,'atualizadoEm',stamp,'historico',coalesce(registro->'historico','[]')||hist||jsonb_build_array(jsonb_build_object('em',stamp,'por',p_por,'acao','confirmou classificação de vínculo','antes',registro->'classificacaoVinculo'))),atualizado_em=now() where colecao='rec' and registro->'omie'->>'titulo'=p_tid and registro->>'apagadoEm' is null;
  if fonte is not null then update bsq_registros set registro=(registro-'classificacaoVinculo')||jsonb_build_object('atualizadoEm',stamp,'historico',coalesce(registro->'historico','[]')||jsonb_build_array(jsonb_build_object('em',stamp,'por',p_por,'acao','confirmou classificação de vínculo','antes',fonte->'classificacaoVinculo'))),atualizado_em=now() where colecao='titulo' and id=fonte->>'id'; end if;
  update bsq_conciliacao_estado set revisao=revisao+1 where id=true;
end $$;
revoke all on function public.bsq_vincular_titulo(text,text,text,text) from public, anon, authenticated;
grant execute on function public.bsq_vincular_titulo(text,text,text,text) to service_role;

-- A edição comum também participa do lock: uma escrita que leu antes do
-- agrupamento não pode esperar a transação e substituí-la com o retrato antigo.
create or replace function public.bsq_gravar_registro_cas(p_colecao text,p_id text,p_antes jsonb,p_novo jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare atual jsonb;
begin
  if p_colecao is null or p_colecao not in ('venda','rec','titulo') then raise exception 'Coleção não permitida na gravação financeira'; end if;
  if coalesce(p_id,'')='' or jsonb_typeof(p_novo) is distinct from 'object' or p_novo->>'id' is distinct from p_id then raise exception 'Identidade do registro inválida'; end if;
  perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
  select registro into atual from bsq_registros where colecao=p_colecao and id=p_id for update;
  if atual is distinct from nullif(p_antes,'null'::jsonb) then raise exception using errcode='40001',message='O registro mudou durante a gravação. Atualize a ficha e confira novamente'; end if;
  if p_colecao='venda' and coalesce(atual->>'incorporadaEmVendaId','')<>'' then raise exception 'Cadastro incorporado: opere pelo contrato principal'; end if;
  insert into bsq_registros(colecao,id,registro,apagado,atualizado_em) values(p_colecao,p_id,p_novo,coalesce(p_novo->>'apagadoEm','')<>'',now())
    on conflict(colecao,id) do update set registro=excluded.registro,apagado=excluded.apagado,atualizado_em=excluded.atualizado_em;
  update bsq_conciliacao_estado set revisao=revisao+1 where id=true;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.bsq_gravar_registro_cas(text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bsq_gravar_registro_cas(text,text,jsonb,jsonb) to service_role;

create or replace function public.bsq_gravar_venda_cas(p_id text,p_antes jsonb,p_novo jsonb)
returns jsonb language sql security invoker set search_path=public as $$
  select public.bsq_gravar_registro_cas('venda',p_id,p_antes,p_novo);
$$;
revoke all on function public.bsq_gravar_venda_cas(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bsq_gravar_venda_cas(text,jsonb,jsonb) to service_role;
