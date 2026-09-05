create or replace function public.bsq_editar_centro(p_anterior text,p_nome text,p_por text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare cfg jsonb; nomes jsonb; hist jsonb; stamp text; linha record; novo jsonb;
begin
  p_nome=trim(p_nome);p_anterior=trim(coalesce(p_anterior,''));
  if length(p_nome)<2 or length(p_nome)>100 then raise exception 'Informe um nome entre 2 e 100 caracteres';end if;
  perform pg_advisory_xact_lock(hashtext('bsq_centros_custo'));
  select config into cfg from bsq_cfg where id=true for update;
  cfg=coalesce(cfg,'{}');nomes=coalesce(cfg->'centrosCusto','[]');
  if exists(select 1 from jsonb_array_elements_text(nomes) n where lower(n)=lower(p_nome) and n<>p_anterior) then raise exception 'Este centro de custo já existe';end if;
  select coalesce(jsonb_agg(to_jsonb(case when n=p_anterior then p_nome else n end)),'[]') into nomes from jsonb_array_elements_text(nomes) n;
  if not (nomes ? p_nome) then nomes=nomes||jsonb_build_array(p_nome);end if;
  stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  hist=jsonb_build_array(jsonb_build_object('id',stamp,'em',stamp,'por',p_por,'acao','renomeou centro de custo','antes',p_anterior,'depois',p_nome));
  if p_anterior<>'' and p_anterior<>p_nome then
    for linha in select colecao,id,registro from bsq_registros where colecao in('cx','rec','titulo','obrigacao','venda','prev') for update loop
      novo=linha.registro;
      if novo->>'centroCusto'=p_anterior then novo=jsonb_set(novo,'{centroCusto}',to_jsonb(p_nome));end if;
      if linha.colecao='venda' and jsonb_typeof(novo->'parcelas')='array' then
        novo=jsonb_set(novo,'{parcelas}',(select coalesce(jsonb_agg(case when p->>'centroCusto'=p_anterior then jsonb_set(p,'{centroCusto}',to_jsonb(p_nome)) else p end),'[]') from jsonb_array_elements(novo->'parcelas') p));
      end if;
      if novo<>linha.registro then update bsq_registros set registro=novo||jsonb_build_object('editadoAMao',true,'atualizadoEm',stamp,'historico',coalesce(novo->'historico','[]')||hist),atualizado_em=now() where colecao=linha.colecao and id=linha.id;end if;
    end loop;
  end if;
  cfg=cfg||jsonb_build_object('centrosCusto',nomes,'atualizadoEm',stamp,'atualizadoPor',p_por);
  insert into bsq_cfg(id,config,atualizado_em)values(true,cfg,now())on conflict(id)do update set config=excluded.config,atualizado_em=excluded.atualizado_em;
  return nomes;
end $$;
revoke all on function public.bsq_editar_centro(text,text,text) from public,anon,authenticated;
grant execute on function public.bsq_editar_centro(text,text,text) to service_role;
