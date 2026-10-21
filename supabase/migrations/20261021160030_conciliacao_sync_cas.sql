-- Uma página Omie só pode substituir seus registros se nenhuma conferência
-- humana foi concluída desde a leitura inicial. Verificação e escrita usam a
-- mesma transação/lock da conciliação: um snapshot antigo nunca ganha por último.
create or replace function public.bsq_financeiro_revisao()
returns bigint language plpgsql stable security invoker set search_path=public as $$
declare atual bigint;
begin
  select revisao into atual from public.bsq_conciliacao_estado where id=true;
  if atual is null then raise exception 'Revisão financeira indisponível'; end if;
  return atual;
end $$;

create or replace function public.bsq_omie_aplicar_pagina(p_revisao bigint,p_itens jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare atual bigint; quantidade integer;
begin
  perform pg_advisory_xact_lock(hashtext('bsq_vinculo_financeiro'));
  select revisao into atual from public.bsq_conciliacao_estado where id=true for update;
  if p_revisao is null or p_revisao<0 or atual is null or atual is distinct from p_revisao then
    raise exception using errcode='40001',message='A conciliação mudou os dados durante a sincronização. A página precisa de nova leitura';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Página Omie inválida'; end if;
  if exists(select 1 from jsonb_array_elements(p_itens) it where
      jsonb_typeof(it) is distinct from 'object' or
      coalesce(it->>'colecao','') not in ('venda','rec','titulo','cx','cliente','movbanco') or
      coalesce(length(trim(it->>'id')),0)=0 or
      jsonb_typeof(it->'registro') is distinct from 'object' or
      it->'registro'->>'id' is distinct from it->>'id') then
    raise exception 'Registro ou coleção inválida na página Omie';
  end if;
  -- Um título pode aparecer novamente na mesma página, e uma venda pode
  -- receber parcelas redirecionadas. A última versão calculada é a final.
  insert into public.bsq_registros(colecao,id,registro,atualizado_em,apagado)
    select colecao,id,registro,coalesce((registro->>'atualizadoEm')::timestamptz,now()),
      coalesce(registro->>'apagadoEm','')<>'' from (
      select distinct on(it->>'colecao',it->>'id') it->>'colecao' as colecao,it->>'id' as id,it->'registro' as registro
      from jsonb_array_elements(p_itens) with ordinality as pagina(it,ordem)
      order by it->>'colecao',it->>'id',ordem desc
    ) finais
    on conflict(colecao,id) do update set registro=excluded.registro,
      atualizado_em=excluded.atualizado_em,apagado=excluded.apagado;
  get diagnostics quantidade=row_count;
  return jsonb_build_object('ok',true,'quantidade',quantidade);
end $$;

revoke all on function public.bsq_financeiro_revisao() from public,anon,authenticated;
revoke all on function public.bsq_omie_aplicar_pagina(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.bsq_financeiro_revisao() to service_role;
grant execute on function public.bsq_omie_aplicar_pagina(bigint,jsonb) to service_role;
