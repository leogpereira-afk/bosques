-- Preserva condições comerciais e cobra cada título uma única vez.
CREATE OR REPLACE FUNCTION public.bsq_agrupar_contratos(p_pedido jsonb, p_por text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  pedido jsonb; anterior record; resultado jsonb; principal text; operacao text; motivo text; politica text; plano jsonb; esperado jsonb;
  ids text[]; recibos_pedidos text[]; titulos_pedidos text[]; recibos text[]:=array[]::text[]; tids text[]:=array[]::text[]; lote_ids text[]:=array[]::text[];
  v jsonb; principal_antes jsonb; fonte jsonb; recebido jsonb; origem_venda jsonb; lote jsonb; novas jsonb; p jsonb; local_p jsonb;
  mapa jsonb:='{}'; manuais jsonb:='{}'; parcelas jsonb:='[]'; lotes jsonb:='[]'; dados_lote jsonb; hist jsonb; depois jsonb;
  versoes jsonb:='{}'; selecionadas jsonb:='{}'; fontes jsonb:='{}'; antes_grupo jsonb:='{}'; stamp text; cpf text; cpf_r text;
  ident text; tid text; lid text; chave text; campo text; linha record; valor numeric; ordinal integer; conjunto boolean; condicoes jsonb := '[]'; total_original numeric;
begin
  if jsonb_typeof(p_pedido) is distinct from 'object' then raise exception 'Pedido de agrupamento inválido'; end if;
  principal=trim(coalesce(p_pedido->>'principal',''));operacao=p_pedido->>'operacao';motivo=trim(coalesce(p_pedido->>'motivo',''));politica=p_pedido->>'politica';
  conjunto=coalesce(p_pedido->>'modo','')='cobranca_conjunta';
  plano=p_pedido->'plano';esperado=p_pedido->'esperado';
  if principal='' or length(motivo)<3 or coalesce(length(trim(p_por)),0)=0 then raise exception 'Principal, motivo e responsável obrigatórios'; end if;
  if coalesce(length(operacao),0)<8 or length(operacao)>100 then raise exception 'Identificador da operação inválido'; end if;
  if conjunto then
    if politica is distinct from 'preservar' or p_pedido->'confirmarCobrancaConjunta' is distinct from 'true'::jsonb or p_pedido->'entradaIncluidaNoEspelho' is distinct from 'true'::jsonb or p_pedido ? 'plano' then raise exception 'Confirme a cobrança conjunta com entrada nos títulos, sem novo plano'; end if;
    plano=jsonb_build_object('entradaNoEspelho',true);
  else
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
    if v ? 'agrupamento' or v ? 'cobrancaConjunta' then raise exception 'Grupo existente: preserve as condições originais; reagrupamento exige conferência específica'; end if;
    select coalesce(sum(coalesce((x->>'valorDia')::numeric,(x->>'valor')::numeric,0)),0) into total_original from jsonb_array_elements(coalesce(v->'parcelas','[]')) x where not coalesce((x->>'cancelado')::boolean,false) and not coalesce((x->>'_remover')::boolean,false);
    if not coalesce((v->>'entradaNoEspelho')::boolean,false) then total_original=total_original+coalesce((v->>'entrada')::numeric,0); end if;
    condicoes=condicoes||jsonb_build_array((v-'historico'-'parcelas'-'anexos'-'cobrancas')||case when jsonb_array_length(coalesce(v->'parcelas','[]'))>0 then jsonb_build_object('totalPlanoOriginal',round(total_original,2)) else '{}'::jsonb end);
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
          if politica in ('pendente','preservar') and jsonb_build_array(p->'valor',p->'venc') is distinct from jsonb_build_array(mapa->tid->'valor',mapa->tid->'venc') then raise exception 'Condições locais divergentes. Confira ou escolha expressamente o nominal e vencimento da origem'; end if;
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
    if conjunto and (local_p is null or (local_p->>'valor')::numeric is distinct from (fonte->>'valor')::numeric or local_p->>'venc' is distinct from fonte->>'venc') then raise exception 'Valor ou vencimento divergente ou ausente na ficha; nada foi alterado'; end if;
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
    'agrupamento',jsonb_build_object('operacao',operacao,'vendas',to_jsonb(ids),'condicoesOriginais',condicoes,'motivo',motivo,'em',stamp,'por',p_por),'atualizadoEm',stamp,'atualizadoPor',p_por);
  if conjunto then novas=novas||jsonb_build_object('cobrancaConjunta',jsonb_build_object('versao',1,'em',stamp,'por',p_por,'condicoesPreservadas',true)); end if;
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
end $function$

;
