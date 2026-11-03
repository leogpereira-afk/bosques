-- Preserva eventos administrativos de títulos e movimentos bancários.
-- Mantém o prefixo histórico anterior e descarta apenas novos snapshots Omie
-- idênticos à fonte atual. Não limpa nem reconstrói históricos existentes.
CREATE OR REPLACE FUNCTION public.bsq_historico_sem_copia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  anterior jsonb;
  recebido jsonb;
  prefixo jsonb;
  adicionais jsonb;
begin
  if new.registro->'original' is not distinct from old.registro->'original'
     and new.registro->'historico' is distinct from old.registro->'historico' then
    anterior := coalesce(nullif(old.registro->'historico', 'null'::jsonb), '[]'::jsonb);
    recebido := coalesce(nullif(new.registro->'historico', 'null'::jsonb), '[]'::jsonb);
    if jsonb_typeof(anterior) = 'array' and jsonb_typeof(recebido) = 'array'
       and jsonb_array_length(recebido) >= jsonb_array_length(anterior) then
      select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
        into prefixo
        from jsonb_array_elements(recebido) with ordinality e(value, ord)
        where e.ord <= jsonb_array_length(anterior);
      if prefixo = anterior then
        select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
          into adicionais
          from jsonb_array_elements(recebido) with ordinality e(value, ord)
          where e.ord > jsonb_array_length(anterior)
            and not coalesce(
              jsonb_typeof(e.value) = 'object'
              and e.value->>'por' = 'omie'
              and jsonb_typeof(e.value->'original') = 'object'
              and e.value->'original' = old.registro->'original'
              and e.value - 'em' - 'por' - 'original' = '{}'::jsonb,
              false
            );
        new.registro := jsonb_set(new.registro, '{historico}', anterior || adicionais);
      else
        new.registro := jsonb_set(new.registro, '{historico}', anterior);
      end if;
    else
      new.registro := jsonb_set(new.registro, '{historico}', anterior);
    end if;
  end if;
  return new;
end
$function$;
