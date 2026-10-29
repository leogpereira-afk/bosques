/* Classificação de entradas fictícias em PostgreSQL em memória; sem dados ou rede reais. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const roots=[process.env.BSQ_TEST_DEPS,path.resolve('seed/devtools'),process.cwd()].filter(Boolean);
const {PGlite}=require(require.resolve('@electric-sql/pglite',{paths:roots}));
const stamp='2026-10-01T00:00:00.000Z',nova='20261029150740_classificacao_entrada_sem_venda_selecao.sql';
(async()=>{
 const db=new PGlite();let testes=0,n=0;
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create table bsq_registros(colecao text,id text,registro jsonb,atualizado_em timestamptz,apagado boolean not null default false,primary key(colecao,id));create table bsq_seq_idx(colecao text,numero int,reg_id text);create sequence numero_ficticio;create function bsq_proximo_numero(text) returns int language sql as $$select nextval('numero_ficticio')::int$$;");
 for(const f of ['202609060005_identificar_pagamentos.sql','202609060006_identificar_familia_omie.sql','202609060002_vendas_omie_distratos.sql','202609060008_identificacao_titulos_desempenho.sql','202610070001_historico_vinculo_unico.sql','20261021155644_conciliacao_financeira_auditavel.sql','20261021160030_conciliacao_sync_cas.sql','20261029150737_contratos_multilotes_selecao.sql'])await db.exec(fs.readFileSync(path.join('supabase/migrations',f),'utf8'));
 if(fs.existsSync(path.join('supabase/migrations',nova)))await db.exec(fs.readFileSync(path.join('supabase/migrations',nova),'utf8'));
 assert.ok((await db.query("select to_regprocedure('public.bsq_classificar_entrada(jsonb,text)') fn")).rows[0].fn,'A confirmação sem venda precisa de RPC transacional própria');
 const put=(col,id,r)=>db.query('insert into bsq_registros values($1,$2,$3,now(),$4) on conflict(colecao,id) do update set registro=excluded.registro,apagado=excluded.apagado',[col,id,JSON.stringify({id,atualizadoEm:stamp,...r}),!!r.apagadoEm]);
 const get=async(col,id)=>(await db.query('select registro from bsq_registros where colecao=$1 and id=$2',[col,id])).rows[0]?.registro;
 const snap=async()=>JSON.stringify((await db.query('select colecao,id,registro,apagado from bsq_registros order by colecao,id')).rows);
 const rev=async()=>Number((await db.query('select public.bsq_financeiro_revisao() r')).rows[0].r);
 const base=async()=>{
  await db.exec('truncate bsq_registros,bsq_conciliacoes,bsq_auditoria_vinculos,bsq_seq_idx;update bsq_conciliacao_estado set revisao=0;');
  await put('venda','v-distratada',{clienteId:'111',situacao:'distratada',quadra:1,lote:2,parcelas:[{tid:'T-FICTICIO',valor:100,venc:'2026-09-01'}]});
  await put('venda','v-ativa',{clienteId:'111',situacao:'ativa',quadra:1,lote:2,parcelas:[]});
  await put('titulo','CONTA_A_RECEBER-T-FICTICIO',{grupo:'CONTA_A_RECEBER',titulo:'T-FICTICIO',origem:'omie',cpf:'111',status:'RECEBIDO',valor:100,venc:'2026-09-01',original:{resumo:{nValPago:100,nValLiquido:100,nValAberto:0,cLiquidado:'S'},detalhes:{cNumTitulo:'Q01L02'}}});
  await put('rec','rbomie-T-FICTICIO',{origem:'omie',valor:100,data:'2026-10-01',contaId:'banco-ficticio',forma:'PIX',vendaId:'v-distratada',alocacoes:[{tid:'T-FICTICIO',valor:100}],omie:{titulo:'T-FICTICIO',cpf:'111'},obs:'Recibo fictício'});
  await put('rec','manual-ficticio',{valor:30,data:'2026-10-02',contaId:'caixa-ficticio',vendaId:'',alocacoes:[]});
  await put('cx','cx-ficticio',{tipo:'entrada',valor:50,data:'2026-10-03'});
 };
 const pedido=(x={})=>({id:'rbomie-T-FICTICIO',tipo:'sem_venda',motivo:'Boleto fictício de teste conferido',operacao:'op-classificar-'+(++n),esperado:{recebimento:stamp,titulo:stamp},...x});
 const call=async(x={},por='Pessoa fictícia')=>(await db.query('select public.bsq_classificar_entrada($1::jsonb,$2) r',[JSON.stringify(x),por])).rows[0].r;
 const test=async(nome,fn)=>{await base();await fn();console.log('OK '+nome);testes++;};
 await test('confirma recebimento existente e título sem criar caixa ou editar contrato',async()=>{
  const antes=await get('rec','rbomie-T-FICTICIO'),fonte=await get('titulo','CONTA_A_RECEBER-T-FICTICIO'),v=await get('venda','v-distratada'),cx=await get('cx','cx-ficticio');const p=pedido();const r=await call(p);
  assert.equal(r.ok,true);assert.deepEqual(r.colecoes,['rec','titulo']);const depois=await get('rec',antes.id);
  for(const k of ['id','valor','data','contaId','origem','omie','forma','obs'])assert.deepEqual(depois[k],antes[k]);
  assert.equal(depois.vendaId,'');assert.deepEqual(depois.alocacoes,[]);assert.equal(depois.conferir,false);
  assert.equal(depois.classificacaoVinculo.tipo,'sem_venda');assert.equal(depois.classificacaoVinculo.por,'Pessoa fictícia');assert.equal(depois.classificacaoVinculo.operacao,p.operacao);assert.equal(depois.classificacaoVinculo.motivo,p.motivo);assert.ok(depois.classificacaoVinculo.em);
  assert.deepEqual((await get('titulo',fonte.id)).original,fonte.original);assert.deepEqual((await get('titulo',fonte.id)).classificacaoVinculo,depois.classificacaoVinculo);
  assert.deepEqual(await get('venda','v-distratada'),v);assert.deepEqual(await get('cx','cx-ficticio'),cx);assert.equal((await db.query("select count(*)::int n from bsq_registros where colecao='rec'")).rows[0].n,2);
  assert.equal(depois.historico.at(-1).antes.vendaId,'v-distratada');assert.deepEqual(depois.historico.at(-1).antes.alocacoes,antes.alocacoes);assert.equal(await rev(),1);
 });
 await test('manual sem título conserva entrada e só altera rec',async()=>{const r=await call(pedido({id:'manual-ficticio',esperado:{recebimento:stamp,titulo:null}}));assert.deepEqual(r.colecoes,['rec']);assert.equal((await get('rec','manual-ficticio')).valor,30);});
 await test('reabertura mantém vínculo vazio e histórico sem restaurar contrato',async()=>{await call(pedido());const r=await get('rec','rbomie-T-FICTICIO'),t=await get('titulo','CONTA_A_RECEBER-T-FICTICIO');await call(pedido({tipo:'pendente',motivo:'Reabrir conferência fictícia',esperado:{recebimento:r.atualizadoEm,titulo:t.atualizadoEm}}));const novo=await get('rec',r.id);assert.equal(novo.classificacaoVinculo.tipo,'pendente');assert.equal(novo.vendaId,'');assert.deepEqual(novo.alocacoes,[]);assert.equal(novo.conferir,true);assert.equal(novo.historico.length,2);});
 await test('repetição idempotente não grava nem incrementa revisão novamente',async()=>{const p=pedido({operacao:'operacao-fixa-ficticia'});await call(p);const antes=await snap(),revisao=await rev();assert.equal((await call(p)).repetida,true);assert.equal(await snap(),antes);assert.equal(await rev(),revisao);assert.equal((await db.query('select count(*)::int n from bsq_conciliacoes')).rows[0].n,1);await assert.rejects(call({...p,motivo:'Motivo diferente'}),e=>e.code==='40001');});
 await test('CAS exige versões de recebimento e título e recusa cache antigo',async()=>{for(const esperado of [null,{}, {recebimento:stamp}, {recebimento:'antiga',titulo:stamp},{recebimento:stamp,titulo:'antiga'}]){const antes=await snap();await assert.rejects(call(pedido({esperado})),e=>e.code==='40001');assert.equal(await snap(),antes);}});
 await test('motivo autor tipo e operação são obrigatórios',async()=>{for(const x of [{motivo:'x'},{tipo:'receita'},{operacao:''},{id:''}])await assert.rejects(call(pedido(x)));await assert.rejects(call(pedido(),''));});
 await test('sem_venda não nasce em recibo inexistente ou sem valor positivo',async()=>{await assert.rejects(call(pedido({id:'nao-existe'})),/recebimento|encontrado/i);const r=await get('rec','rbomie-T-FICTICIO');await put('rec',r.id,{...r,valor:0});await assert.rejects(call(pedido()),/valor/i);});
 await test('recibo apagado e origem indisponível são recusados sem mutação',async()=>{for(const col of ['rec','titulo']){const id=col==='rec'?'rbomie-T-FICTICIO':'CONTA_A_RECEBER-T-FICTICIO';await db.query('update bsq_registros set apagado=true where colecao=$1 and id=$2',[col,id]);const antes=await snap();await assert.rejects(call(pedido()),/indisponível|encontrado|apagado/i);assert.equal(await snap(),antes);await db.query('update bsq_registros set apagado=false where colecao=$1 and id=$2',[col,id]);}});
 await test('contrato ativo não é desfeito pela classificação',async()=>{const r=await get('rec','rbomie-T-FICTICIO');await put('rec',r.id,{...r,vendaId:'v-ativa'});const antes=await snap();await assert.rejects(call(pedido()),/contrato|venda/i);assert.equal(await snap(),antes);});
 await test('título em parcela ativa bloqueia classificação mesmo se recibo aponta distrato',async()=>{await put('venda','v-ativa',{clienteId:'111',situacao:'ativa',parcelas:[{tid:'T-FICTICIO',valor:100,venc:'2026-09-01'}]});await assert.rejects(call(pedido()),/parcela|vínculo|contrato/i);});
 await test('alocação em outra parcela ativa bloqueia classificação',async()=>{const r=await get('rec','rbomie-T-FICTICIO');await put('rec',r.id,{...r,alocacoes:[{tid:'OUTRA',valor:100}]});await put('venda','v-ativa',{situacao:'ativa',parcelas:[{tid:'OUTRA',valor:100}]});await assert.rejects(call(pedido()),/aloca|parcela|distribui/i);});
 await test('recibos múltiplos para o título exigem conferência própria',async()=>{await put('rec','segundo-ficticio',{valor:50,data:'2026-10-01',omie:{titulo:'T-FICTICIO'}});await assert.rejects(call(pedido()),/múltipl|mais de um|outro recebimento/i);});
 await test('falha ao gravar título reverte recebimento ledger e revisão',async()=>{await db.exec("create function pg_temp.falhar_classificacao() returns trigger language plpgsql as $$begin raise exception 'Falha fictícia';end$$;create trigger falha_classificacao before update on bsq_registros for each row when(new.colecao='titulo') execute function pg_temp.falhar_classificacao();");const antes=await snap();try{await assert.rejects(call(pedido()),/Falha fictícia/);assert.equal(await snap(),antes);assert.equal(await rev(),0);assert.equal((await db.query('select count(*)::int n from bsq_conciliacoes')).rows[0].n,0);}finally{await db.exec('drop trigger falha_classificacao on bsq_registros');}});
 await test('página Omie lida antes da classificação não sobrescreve decisão',async()=>{const antigo=await get('rec','rbomie-T-FICTICIO'),revisao=await rev();await call(pedido());const antes=await snap();await assert.rejects(db.query('select public.bsq_omie_aplicar_pagina($1,$2::jsonb)',[revisao,JSON.stringify([{colecao:'rec',id:antigo.id,registro:antigo}])]),e=>e.code==='40001');assert.equal(await snap(),antes);});
 for(const tipo of ['sem_venda','pendente'])await test('automatismos respeitam classificação explícita '+tipo,async()=>{
  const p=pedido();await call(p);if(tipo==='pendente'){const r=await get('rec','rbomie-T-FICTICIO'),t=await get('titulo','CONTA_A_RECEBER-T-FICTICIO');await call(pedido({tipo,esperado:{recebimento:r.atualizadoEm,titulo:t.atualizadoEm}}));}
  await db.query("delete from bsq_registros where colecao='venda' and id='v-distratada'");
  const antes=await snap();await db.query('select bsq_identificar_pagamentos_omie(true)');await db.query('select bsq_identificar_titulos_omie(true)');assert.equal(await snap(),antes);
  await db.query("delete from bsq_registros where colecao='venda'");await put('lote','lote-ficticio',{quadra:1,lote:2,status:'Disponível'});await put('cliente','111',{cpf:'111',nome:'Pessoa fictícia'});
  const antesImportar=await snap();await db.query('select bsq_importar_vendas_omie()');assert.equal(await snap(),antesImportar);assert.equal((await db.query("select count(*)::int n from bsq_registros where colecao='venda'")).rows[0].n,0);
 });
 for(const rpc of ['bsq_identificar_pagamentos_omie','bsq_identificar_titulos_omie'])await test(rpc+' mantém associação normal e ignora alias incorporado',async()=>{
  await db.query("delete from bsq_registros where colecao='venda' and id='v-distratada'");
  const r=await get('rec','rbomie-T-FICTICIO');await put('rec',r.id,{...r,vendaId:'',alocacoes:[]});
  await put('venda','alias-ficticio',{clienteId:'111',situacao:'ativa',quadra:1,lote:2,incorporadaEmVendaId:'v-ativa',parcelas:[]});
  await db.query('select '+rpc+'(true)');assert.equal((await get('rec',r.id)).vendaId,'v-ativa');
  assert.equal((await get('venda','v-ativa')).parcelas[0].tid,'T-FICTICIO');assert.equal((await get('venda','alias-ficticio')).parcelas.length,0);
 });
 await test('importador continua criando venda legítima sem classificação explícita',async()=>{
  await db.query("delete from bsq_registros where colecao='venda'");const r=await get('rec','rbomie-T-FICTICIO');await put('rec',r.id,{...r,vendaId:'',alocacoes:[]});
  await put('lote','lote-ficticio',{quadra:1,lote:2,status:'Disponível'});await put('cliente','111',{cpf:'111',nome:'Pessoa fictícia'});
  await db.query('select bsq_importar_vendas_omie()');assert.equal((await db.query("select count(*)::int n from bsq_registros where colecao='venda'")).rows[0].n,1);assert.equal((await get('rec',r.id)).vendaId,'venda-omie-lote-ficticio');
 });
 await test('decisão explícita só no recebimento também bloqueia automatismos',async()=>{
  const r=await get('rec','rbomie-T-FICTICIO');await put('rec',r.id,{...r,vendaId:'',alocacoes:[],classificacaoVinculo:{tipo:'sem_venda'}});await db.query("delete from bsq_registros where colecao='venda' and id='v-distratada'");
  const antes=await snap();await db.query('select bsq_identificar_pagamentos_omie(true)');await db.query('select bsq_identificar_titulos_omie(true)');assert.equal(await snap(),antes);
 });
 await test('RPC não é pública e só serviço autenticado pelo backend executa',async()=>{const q=(await db.query("select has_function_privilege('anon','public.bsq_classificar_entrada(jsonb,text)','execute') a,has_function_privilege('authenticated','public.bsq_classificar_entrada(jsonb,text)','execute') b,has_function_privilege('service_role','public.bsq_classificar_entrada(jsonb,text)','execute') s")).rows[0];assert.equal(q.a,false);assert.equal(q.b,false);assert.equal(q.s,true);});
 await db.close();console.log(JSON.stringify({testes,resultado:'aprovado'}));
})().catch(e=>{console.error(e);process.exit(1);});
