-- Confirmações humanas da conciliação. Não aplica dados reais nem altera o Omie.
-- O ledger guarda o resultado de cada pedido para uma nova tentativa não repetir
-- vínculos, alocações, eventos históricos ou uma ida à lixeira.
create table if not exists public.bsq_conciliacoes (
  operacao text primary key,
  pedido jsonb not null,
  resultado jsonb not null,
  por text not null,
  em timestamptz not null default now()
);
alter table public.bsq_conciliacoes enable row level security;
revoke all on table public.bsq_conciliacoes from public, anon, authenticated;
grant select, insert on table public.bsq_conciliacoes to service_role;

-- Revisão usada pelo importador para não aplicar um retrato obtido antes da
-- decisão humana. A RPC de aplicação da página participa do mesmo lock.
create table if not exists public.bsq_conciliacao_estado (
  id boolean primary key default true check(id),
  revisao bigint not null default 0
);
insert into public.bsq_conciliacao_estado(id,revisao) values(true,0) on conflict(id) do nothing;
alter table public.bsq_conciliacao_estado enable row level security;
revoke all on table public.bsq_conciliacao_estado from public, anon, authenticated;
grant select, update on table public.bsq_conciliacao_estado to service_role;

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
    if dest is null or coalesce(dest->>'apagadoEm','')<>'' or coalesce(dest->>'situacao','ativa') not in ('ativa','conferir','quitada') then raise exception 'Contrato de destino indisponível, cancelado ou distratado'; end if;
    cpf_destino=regexp_replace(coalesce(dest->>'clienteId',''),'[^0-9]','','g');
    if p_tipo='titulo' then
      select registro into fonte from public.bsq_registros where colecao='titulo' and id='CONTA_A_RECEBER-'||p_id and not coalesce(apagado,false);
      if fonte is null or coalesce(fonte->>'apagadoEm','')<>'' or fonte->>'grupo' is distinct from 'CONTA_A_RECEBER' then raise exception 'Título a receber não encontrado'; end if;
      if coalesce((fonte->>'cancelado')::boolean,false) or upper(coalesce(fonte->>'status',''))='CANCELADO' then raise exception 'Título cancelado não pode ser vinculado'; end if;
      cpf=regexp_replace(coalesce(fonte->>'cpf',''),'[^0-9]','','g');
      if cpf='' or cpf_destino='' or cpf<>cpf_destino then raise exception 'O título pertence a outro cliente ou está sem CPF verificável'; end if;
      versoes=jsonb_build_object('titulo',fonte->'atualizadoEm','venda',dest->'atualizadoEm');
    else
      select registro into recebido from public.bsq_registros where colecao='rec' and id=p_id and not coalesce(apagado,false);
      if recebido is null or coalesce(recebido->>'apagadoEm','')<>'' then raise exception 'Recebimento não encontrado ou indisponível'; end if;
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
    for linha in select id,registro from public.bsq_registros where colecao='venda' and not coalesce(apagado,false) and coalesce(registro->>'apagadoEm','')='' order by id loop
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
    for linha in select id,registro from public.bsq_registros where colecao='venda' and not coalesce(apagado,false) and coalesce(registro->>'apagadoEm','')='' order by id loop
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
      if exists(select 1 from jsonb_array_elements(coalesce(linha.registro->'alocacoes','[]')) a where a->>'tid' is distinct from p_id) then raise exception 'O recebimento foi distribuído em outras parcelas. Confira a distribuição antes de mudar o contrato'; end if;
      alocacoes=jsonb_build_array(jsonb_build_object('tid',p_id,'valor',linha.registro->'valor'));
      antes=jsonb_build_object('vendaId',linha.registro->'vendaId','alocacoes',linha.registro->'alocacoes');
      depois=jsonb_build_object('vendaId',p_destino,'alocacoes',alocacoes);
      hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':rec:'||linha.id,'em',stamp,'por',p_por,'acao','conciliou recebimento do título','titulo',p_id,'motivo',trim(p_motivo),'antes',antes,'depois',depois));
      update public.bsq_registros set registro=linha.registro||depois||jsonb_build_object('conferir',false,'editadoAMao',true,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(linha.registro->'historico','[]')||hist),atualizado_em=now() where colecao='rec' and id=linha.id;
    end loop;
    -- A versão do título também muda: protege duas conferências simultâneas
    -- que escolhem destinos diferentes e cujas vendas ainda não mudaram.
    hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':titulo:'||p_id,'em',stamp,'por',p_por,'acao','confirmou contrato do título','destino',p_destino,'politica',p_politica,'motivo',trim(p_motivo),'antes',fonte->'conciliacao'));
    update public.bsq_registros set registro=fonte||jsonb_build_object('conciliacao',jsonb_build_object('operacao',p_operacao,'vendaId',p_destino,'politica',p_politica,'em',stamp,'por',p_por),'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(fonte->'historico','[]')||hist),atualizado_em=now() where colecao='titulo' and id='CONTA_A_RECEBER-'||p_id;
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
    antes=jsonb_build_object('vendaId',recebido->'vendaId','alocacoes',recebido->'alocacoes');
    depois=jsonb_build_object('vendaId',p_destino,'alocacoes',alocacoes,'conferir',round(alocado*100)<>round((recebido->>'valor')::numeric*100));
    hist=jsonb_build_array(jsonb_build_object('id',p_operacao||':rec:'||p_id,'em',stamp,'por',p_por,'acao','conciliou contrato do recebimento','motivo',trim(p_motivo),'antes',antes,'depois',depois));
    update public.bsq_registros set registro=recebido||depois||jsonb_build_object('editadoAMao',true,'atualizadoEm',stamp,'atualizadoPor',p_por,'historico',coalesce(recebido->'historico','[]')||hist),atualizado_em=now() where colecao='rec' and id=p_id;
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
