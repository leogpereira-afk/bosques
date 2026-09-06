-- Reutiliza a credencial privada da rotina Bosques dentro do banco, sem expô-la no repositório.
do $$
declare cmd text; segredo text; destino text;
begin
 select command into cmd from cron.job where jobname='bsq-rotina-diaria';
 segredo=substring(cmd from $re$'x-rotina-token'\s*,\s*'([^']+)'$re$);
 destino=replace(substring(cmd from $re$url\s*:=\s*'([^']+)'$re$),'/bsq-rotina','/bsq-omie');
 if segredo is null or destino is null then raise exception 'Rotina Bosques de origem não configurada';end if;
 if not exists(select 1 from vault.secrets where name='bsq_omie_rotina_token') then
  perform vault.create_secret(segredo,'bsq_omie_rotina_token','Autenticação da sincronização automática Bosques');
 end if;
 insert into bsq_meta(chave,valor,atualizado_em) values('omie_automacao',jsonb_build_object('ativa',true,'intervaloMinutos',15,'url',destino),now())
 on conflict(chave) do update set valor=excluded.valor,atualizado_em=excluded.atualizado_em;
end $$;
create or replace function public.bsq_omie_disparar()
returns bigint language plpgsql security invoker set search_path=public as $$
declare segredo text; config_auto jsonb; req bigint;
begin
 select valor into config_auto from bsq_meta where chave='omie_automacao';
 if coalesce((config_auto->>'ativa')::boolean,false)=false then return null;end if;
 if exists(select 1 from bsq_omie_execucao where id=true and (reservado_ate>now() or proxima>now())) then return null;end if;
 select decrypted_secret into segredo from vault.decrypted_secrets where name='bsq_omie_rotina_token';
 if segredo is null then raise exception 'Credencial da rotina Omie não encontrada';end if;
 select net.http_post(url:=config_auto->>'url',headers:=jsonb_build_object('content-type','application/json','x-rotina-token',segredo),
  body:='{"action":"sincronizar","automatico":true}'::jsonb,timeout_milliseconds:=240000) into req;
 return req;
end $$;
revoke all on function public.bsq_omie_disparar() from public,anon,authenticated;
-- O pulso verifica a cada minuto; a execução respeita o intervalo persistido de 15 minutos.
select cron.schedule('bsq-omie-automatico','* * * * *','select public.bsq_omie_disparar()');
