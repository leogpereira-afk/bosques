-- Falhas seguidas da sincronização Omie ficam contadas e visíveis.
-- Antes, cada nova tentativa apagava o erro anterior e repetia a cada 5 minutos
-- sem limite, então uma parada longa (17/09 a 30/09) não deixava rastro na tela.
-- Agora: o erro só some quando uma chamada dá certo, a rodada guarda quantas
-- falhas seguidas houve e desde quando, e a espera cresce (5, 10, 20, 30 min).
alter table public.bsq_omie_execucao add column if not exists tentativas integer not null default 0;
alter table public.bsq_omie_execucao add column if not exists falhando_desde timestamptz;

create or replace function public.bsq_omie_reservar(p_auto boolean,p_inicio text default null,p_completa boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s bsq_omie_execucao; t uuid;
begin
 insert into bsq_omie_execucao(id) values(true) on conflict do nothing;
 select * into s from bsq_omie_execucao where id=true for update;
 if s.reservado_ate>now() then return jsonb_build_object('adquirido',false,'motivo','Sincronização já em andamento');end if;
 if p_auto and s.proxima>now() then return jsonb_build_object('adquirido',false,'motivo','Aguardando próxima atualização');end if;
 if p_inicio is not null and s.inicio is distinct from p_inicio then
  return jsonb_build_object('adquirido',false,'motivo','Esta rodada já foi encerrada. Atualize os dados.');
 end if;
 t=gen_random_uuid();
 update bsq_omie_execucao set
  inicio=coalesce(s.inicio,to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  completa=case when s.inicio is null then p_completa else s.completa end,
  lease=t,reservado_ate=now()+interval '10 minutes'
 where id=true returning * into s;
 return to_jsonb(s)||jsonb_build_object('adquirido',true);
end $$;

create or replace function public.bsq_omie_finalizar(p_lease uuid,p_pagina integer,p_parcial jsonb,p_completa boolean,p_erro text default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
 update bsq_omie_execucao set
  pagina=case when p_erro is not null then pagina when p_pagina=0 then 1 else p_pagina end,
  parcial=case when p_erro is not null then parcial when p_pagina=0 then '{}'::jsonb else p_parcial end,
  completa=case when p_erro is not null then completa when p_pagina=0 then false else p_completa end,
  inicio=case when p_erro is null and p_pagina=0 then null else inicio end,
  reservado_ate=null,lease=null,ultimo_erro=p_erro,
  -- À direita do SET, "tentativas" é o valor de antes desta chamada.
  tentativas=case when p_erro is not null then tentativas+1 else 0 end,
  falhando_desde=case when p_erro is not null then coalesce(falhando_desde,now()) else null end,
  proxima=now()+case
   when p_erro is not null then least(interval '30 minutes', interval '5 minutes'*power(2,least(tentativas,3)))
   when p_pagina=0 then interval '15 minutes' else interval '0 minutes' end
 where id=true and lease=p_lease;
 get diagnostics n=row_count;return n=1;
end $$;

revoke all on function public.bsq_omie_reservar(boolean,text,boolean) from public,anon,authenticated;
revoke all on function public.bsq_omie_finalizar(uuid,integer,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.bsq_omie_reservar(boolean,text,boolean) to service_role;
grant execute on function public.bsq_omie_finalizar(uuid,integer,jsonb,boolean,text) to service_role;
