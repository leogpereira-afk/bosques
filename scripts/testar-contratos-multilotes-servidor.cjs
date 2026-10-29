/* Contratos e valores fictícios. PostgreSQL em memória; nenhuma API real. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const roots=[process.env.BSQ_PGLITE_DEPS,process.env.BSQ_TEST_DEPS,path.resolve('seed/devtools'),process.cwd()].filter(Boolean);
const {PGlite}=require(require.resolve('@electric-sql/pglite',{paths:roots}));
const stamp='2026-01-01T00:00:00.000Z',migration='20261029150737_contratos_multilotes_selecao.sql';
(async()=>{
 const db=new PGlite();let n=0,passaram=0,falhas=0;
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table bsq_registros(colecao text,id text,registro jsonb,atualizado_em timestamptz,apagado boolean default false,primary key(colecao,id));');
 for(const f of ['202610070001_historico_vinculo_unico.sql','20261021155644_conciliacao_financeira_auditavel.sql','20261021160030_conciliacao_sync_cas.sql',migration]){
   const p=path.join('supabase/migrations',f);if(fs.existsSync(p))await db.exec(fs.readFileSync(p,'utf8'));
 }
 const put=async(col,id,r)=>db.query('insert into bsq_registros values($1,$2,$3,now(),$4) on conflict(colecao,id) do update set registro=excluded.registro,apagado=excluded.apagado',[col,id,JSON.stringify({id,atualizadoEm:stamp,...r}),!!r.apagadoEm]);
 const get=async(col,id)=>(await db.query('select registro from bsq_registros where colecao=$1 and id=$2',[col,id])).rows[0]?.registro;
 const snapshot=async()=>JSON.stringify((await db.query('select colecao,id,registro,apagado from bsq_registros order by colecao,id')).rows);
 const parcela=(tid,valor)=>({tid,valor,venc:'2026-12-01',origem:'omie'});
 const fonte=async(tid,valor,cpf='111')=>put('titulo','CONTA_A_RECEBER-'+tid,{titulo:tid,grupo:'CONTA_A_RECEBER',origem:'omie',cpf,status:'ABERTO',valor,venc:'2026-12-01',original:{resumo:{nValAberto:valor,nValPago:0}}});
 const base=async()=>{
   await db.exec('truncate bsq_registros,bsq_conciliacoes;update bsq_conciliacao_estado set revisao=0;');
   for(let i=1;i<=3;i++){
     await put('lote','l'+i,{quadra:1,lote:i,areaM2:300,status:'Vendido',vendaId:'v'+i});
     await put('venda','v'+i,{codigo:'VD-FICTICIA-'+i,clienteId:'111',clienteNome:'Pessoa fictícia',situacao:'ativa',loteId:'l'+i,quadra:1,lote:i,entrada:20,qtdeParcelas:2,valorParcela:300,parcelas:[parcela(i===3?'t2':'t1',i===3?600:300)]});
   }
   await fonte('t1',300);await fonte('t2',600);await fonte('t3',50);await fonte('t4',75);
   await put('rec','r1',{vendaId:'v1',valor:100,data:'2026-10-01',tipo:'parcela',omie:{titulo:'t1',cpf:'111'},alocacoes:[{tid:'t1',valor:100}]});
   await put('rec','r2',{vendaId:'v2',valor:200,data:'2026-10-02',tipo:'entrada',alocacoes:[{tid:'t1',valor:200}]});
   await put('rec','extra',{vendaId:'',valor:50,data:'2026-10-03',omie:{titulo:'t3',cpf:'111'}});
   await put('rec','nao-selecionado',{vendaId:'',valor:75,data:'2026-10-04',omie:{titulo:'t4',cpf:'111'}});
 };
 const pedido=()=>({principal:'v1',vendas:['v1','v2','v3'],recebimentos:['extra'],titulos:[],politica:'origem',motivo:'Contrato conjunto fictício conferido',operacao:'grupo-ficticio-'+(++n),
   plano:{entrada:20,entradaNoEspelho:true,qtdeParcelas:3,valorParcela:300,tipoParcela:'Fixa',inicioParcelas:'2026-12-01'},confirmarPlanoPrincipal:true,
   esperado:{vendas:{v1:stamp,v2:stamp,v3:stamp},recebimentos:{r1:stamp,r2:stamp,extra:stamp},titulos:{t1:stamp,t2:stamp,t3:stamp}}});
 const call=async(p=pedido())=>(await db.query('select public.bsq_agrupar_contratos($1::jsonb,$2) as r',[JSON.stringify(p),'Operador fictício'])).rows[0].r;
 const rejeitar=async(alterar,regex)=>{const p=pedido();await alterar(p);const antes=await snapshot();await assert.rejects(call(p),regex);assert.equal(await snapshot(),antes,'Falha deve reverter toda a transação');};
 const teste=async(nome,fn)=>{await base();try{await fn();passaram++;console.log('OK '+nome);}catch(e){falhas++;console.error('FALHOU '+nome+'\n'+e.stack);}};
 await teste('agrupa três lotes em unidade financeira única sem duplicar caixa ou parcelas',async()=>{
   const recsAntes=(await db.query("select sum((registro->>'valor')::numeric) as total from bsq_registros where colecao='rec'")).rows[0].total;
   const originais=[await get('venda','v2'),await get('venda','v3')],r=await call(),v=await get('venda','v1');
   assert.equal(r.ok,true);assert.equal(r.principal,'v1');assert.equal(v.lotes.length,3);assert.deepEqual(v.loteIds,['l1','l2','l3']);
   assert.equal(v.loteId,'l1');assert.equal(v.entrada,20);assert.equal(v.entradaNoEspelho,true);assert.equal(v.qtdeParcelas,3);
   assert.deepEqual(v.parcelas.map(p=>p.tid).sort(),['t1','t2','t3']);assert.equal(v.parcelas.reduce((s,p)=>s+p.valor,0),950);
   for(let i=2;i<=3;i++){const x=await get('venda','v'+i);assert.equal(x.incorporadaEmVendaId,'v1');assert.equal(x.situacao,'ativa');assert.deepEqual(x.parcelas,originais[i-2].parcelas);}
   for(let i=1;i<=3;i++){const l=await get('lote','l'+i);assert.equal(l.status,'Vendido');assert.equal(l.vendaId,'v1');}
   for(const id of ['r1','r2','extra'])assert.equal((await get('rec',id)).vendaId,'v1');
   assert.equal((await get('rec','r2')).tipo,'entrada');assert.equal((await get('rec','r2')).valor,200);
   assert.equal((await get('rec','nao-selecionado')).vendaId,'');assert.equal((await db.query("select count(*) n from bsq_registros where colecao='rec'")).rows[0].n,4);
   assert.equal((await db.query("select sum((registro->>'valor')::numeric) as total from bsq_registros where colecao='rec'")).rows[0].total,recsAntes);
   assert.ok(v.historico.at(-1).antes);assert.ok((await get('rec','r1')).historico.at(-1).antes);
 });
 await teste('reenvio idempotente não repete históricos nem revisão',async()=>{const p=pedido();await call(p);const antes=await snapshot();assert.equal((await call(p)).repetida,true);assert.equal(await snapshot(),antes);assert.equal((await db.query('select revisao from bsq_conciliacao_estado')).rows[0].revisao,1);});
 await teste('a operação não pode ser reutilizada para outro pedido',async()=>{const p=pedido();await call(p);await assert.rejects(call({...p,motivo:'Outro documento'}),e=>e.code==='40001');});
 await teste('política pendente não confirma valor nem quitação',async()=>{const p=pedido();p.politica='pendente';await call(p);assert.ok((await get('venda','v1')).parcelas.every(p=>p.conferir&&p.vinculoConfirmado));});
 await teste('uma venda recebe apenas os avulsos escolhidos sem criar alias',async()=>{const p=pedido();p.vendas=['v1'];p.recebimentos=['extra'];p.esperado.vendas={v1:stamp};await put('venda','v2',{...(await get('venda','v2')),parcelas:[]});await call(p);assert.equal((await get('venda','v2')).incorporadaEmVendaId,undefined);assert.deepEqual((await get('venda','v1')).parcelas.map(p=>p.tid).sort(),['t1','t3']);});
 await teste('título avulso selecionado pode entrar sem inventar recebimento',async()=>{const p=pedido();p.titulos=['t4'];p.esperado.titulos.t4=stamp;p.esperado.recebimentos['nao-selecionado']=stamp;await call(p);assert.ok((await get('venda','v1')).parcelas.some(p=>p.tid==='t4'));assert.equal((await get('rec','nao-selecionado')).vendaId,'v1');});
 for(const campo of ['vendas','recebimentos','titulos'])await teste('CAS exige todas as versões de '+campo,()=>rejeitar(async p=>{delete p.esperado[campo][Object.keys(p.esperado[campo])[0]];},/mud|vers|atualiz/i));
 await teste('recebimento novo ligado ao grupo depois da leitura exige nova conferência',()=>rejeitar(async()=>{await put('rec','novo',{vendaId:'v3',valor:5,data:'2026-10-05'});},/mud|vers|atualiz/i));
 await teste('CPF divergente cancela agrupamento integral',()=>rejeitar(async()=>{await put('venda','v3',{...(await get('venda','v3')),clienteId:'222'});},/CPF|cliente/i));
 await teste('título de outra venda exige incluir a dona na seleção',()=>rejeitar(async()=>{await put('venda','fora',{clienteId:'111',situacao:'ativa',parcelas:[parcela('t3',50)]});},/selecion|outr.*contrato/i));
 await teste('contrato distratado não é incorporado',()=>rejeitar(async()=>{await put('venda','v3',{...(await get('venda','v3')),situacao:'distratada'});},/distrat|indispon/i));
 await teste('contrato já incorporado não pode ganhar outro principal',()=>rejeitar(async()=>{await put('venda','v3',{...(await get('venda','v3')),incorporadaEmVendaId:'outro'});},/incorpor|principal/i));
 await teste('lote com dono fora do grupo não é apropriado',()=>rejeitar(async()=>{await put('venda','fora',{clienteId:'111',situacao:'ativa',loteId:'l3',parcelas:[]});},/lote|dono/i));
 await teste('título indisponível não pode ser confirmado pela seleção',()=>rejeitar(async()=>{await put('titulo','CONTA_A_RECEBER-t3',{...(await get('titulo','CONTA_A_RECEBER-t3')),ausenteOrigemOmie:true});},/origem|indispon/i));
 await teste('entrada sem venda exige reabrir a classificação antes de associar',()=>rejeitar(async()=>{await put('rec','extra',{...(await get('rec','extra')),classificacaoVinculo:{tipo:'sem_venda'}});},/classifica|sem venda/i));
 await teste('recebimento apagado não ressuscita',()=>rejeitar(async()=>{await put('rec','extra',{...(await get('rec','extra')),apagadoEm:stamp});},/apag|indispon/i));
 await teste('plano precisa de confirmação explícita',()=>rejeitar(async p=>{p.confirmarPlanoPrincipal=false;},/plano|confirm/i));
 await teste('plano recusa campos não permitidos',()=>rejeitar(async p=>{p.plano.clienteId='222';},/plano|campo/i));
 await teste('entrada no espelho exige pelo menos uma parcela',()=>rejeitar(async p=>{p.vendas=['v1'];p.recebimentos=[];await put('venda','v1',{...(await get('venda','v1')),parcelas:[]});await db.exec("delete from bsq_registros where colecao='rec' and registro->>'vendaId'='v1'");},/entrada|parcela|espelho/i));
 await teste('snapshot anterior da sync não desfaz agrupamento',async()=>{await call();await assert.rejects(db.query('select bsq_omie_aplicar_pagina(0,$1::jsonb)',[JSON.stringify([{colecao:'venda',id:'v1',registro:{id:'v1',parcelas:[]}}])]),e=>e.code==='40001');});
 await teste('origem não elimina desconto local não ambíguo',async()=>{for(const id of ['v1','v2']){const v=await get('venda',id);v.parcelas[0].valorDia=250;v.parcelas[0].descontoConfirmado=true;await put('venda',id,v);}await call();const p=(await get('venda','v1')).parcelas.find(p=>p.tid==='t1');assert.equal(p.valorDia,250);assert.equal(p.descontoConfirmado,true);});
 await teste('descontos divergentes exigem conferência mesmo adotando origem',()=>rejeitar(async()=>{const v=await get('venda','v2');v.parcelas[0].valorDia=250;v.parcelas[0].descontoConfirmado=true;await put('venda','v2',v);},/desconto|condiç|diverg/i));
 await teste('política pendente não escolhe primeira condição local divergente',()=>rejeitar(async p=>{p.politica='pendente';const v=await get('venda','v2');v.parcelas[0].valor=350;await put('venda','v2',v);},/diverg|condiç|origem/i));
 await teste('origem explícita resolve só nominal e vencimento divergentes',async()=>{const v=await get('venda','v2');v.parcelas[0].valor=350;v.parcelas[0].venc='2027-01-01';await put('venda','v2',v);await call();const p=(await get('venda','v1')).parcelas.find(p=>p.tid==='t1');assert.equal(p.valor,300);assert.equal(p.venc,'2026-12-01');});
 await teste('pedido preparado pela tela real passa no contrato da RPC',async()=>{const reg={venda:[],rec:[],titulo:[],lote:[]};for(const x of (await db.query('select colecao,registro from bsq_registros')).rows)reg[x.colecao].push(x.registro);const c=pedido();const p=require('../conciliacao-selecao.js').preparar(reg,c,c.operacao);const r=await call(p);assert.equal(r.ok,true);assert.equal((await get('venda','v1')).lotes.length,3);});
 await teste('avulso manual sem CPF verificável não entra no grupo',()=>rejeitar(async p=>{await put('rec','sem-cpf',{valor:10,vendaId:'',data:'2026-10-01'});p.recebimentos.push('sem-cpf');p.esperado.recebimentos['sem-cpf']=stamp;},/CPF|identidade/i));
 await teste('distribuição manual parcial continua em conferência depois do grupo',async()=>{const r=await get('rec','r2');r.alocacoes[0].valor=100;await put('rec','r2',r);await call();const novo=await get('rec','r2');assert.equal(novo.conferir,true);assert.equal(novo.valor,200);assert.equal(novo.alocacoes[0].valor,100);});
 await teste('principal quitada exige escolher principal ativa',()=>rejeitar(async()=>{await put('venda','v1',{...(await get('venda','v1')),situacao:'quitada'});},/principal|quitad|ativa/i));
 await teste('secundária quitada acompanha principal ativa sem perder situação histórica',async()=>{await put('venda','v2',{...(await get('venda','v2')),situacao:'quitada'});await call();assert.equal((await get('venda','v1')).situacao,'ativa');assert.equal((await get('venda','v2')).situacao,'quitada');});
 await teste('parcela manual com tid man-* preserva identidade e alocação sem exigir título Omie',async()=>{const v=await get('venda','v3');v.parcelas.push({tid:'man-ficticia',origem:'manual',valor:50,venc:'2027-01-01'});await put('venda','v3',v);await put('rec','manual',{vendaId:'v3',valor:50,data:'2026-10-01',alocacoes:[{tid:'man-ficticia',valor:50}]});const p=pedido();p.esperado.recebimentos.manual=stamp;await call(p);assert.ok((await get('venda','v1')).parcelas.some(p=>p.tid==='man-ficticia'));assert.deepEqual((await get('rec','manual')).alocacoes,[{tid:'man-ficticia',valor:50}]);});
 await teste('CAS atômico recusa upsert lido antes do agrupamento',async()=>{const antes=await get('venda','v1');await call();const foto=await snapshot();await assert.rejects(db.query('select bsq_gravar_venda_cas($1,$2::jsonb,$3::jsonb)',['v1',JSON.stringify(antes),JSON.stringify({...antes,entrada:1})]),e=>e.code==='40001');assert.equal(await snapshot(),foto);});
 await teste('CAS atômico permite salvar a versão atual do principal',async()=>{await call();const antes=await get('venda','v1'),novo={...antes,obs:'Conferência fictícia atual'};await db.query('select bsq_gravar_venda_cas($1,$2::jsonb,$3::jsonb)',['v1',JSON.stringify(antes),JSON.stringify(novo)]);assert.deepEqual(await get('venda','v1'),novo);});
 await teste('CAS de recebimento rejeita edição iniciada antes de agrupamento sem desfazer vínculo',async()=>{const antes=await get('rec','r2');await call();const foto=await snapshot();await assert.rejects(db.query('select bsq_gravar_registro_cas($1,$2,$3::jsonb,$4::jsonb)',['rec','r2',JSON.stringify(antes),JSON.stringify({...antes,forma:'PIX'})]),e=>e.code==='40001');assert.equal(await snapshot(),foto);});
 await teste('CAS de título rejeita edição antiga após classificação humana',async()=>{const antes=await get('titulo','CONTA_A_RECEBER-t3');await put('titulo',antes.id,{...antes,classificacaoVinculo:{tipo:'sem_venda',motivo:'Documento fictício'},atualizadoEm:'2026-10-29T11:00:00Z'});const foto=await snapshot();await assert.rejects(db.query('select bsq_gravar_registro_cas($1,$2,$3::jsonb,$4::jsonb)',['titulo',antes.id,JSON.stringify(antes),JSON.stringify({...antes,ajustes:{valor:50,venc:'2026-12-02'}})]),e=>e.code==='40001');assert.equal(await snapshot(),foto);});
 await teste('CAS genérico só permite as três coleções financeiras previstas',async()=>{const antes=await get('lote','l1');await assert.rejects(db.query('select bsq_gravar_registro_cas($1,$2,$3::jsonb,$4::jsonb)',['lote','l1',JSON.stringify(antes),JSON.stringify(antes)]),/coleção|Coleção/i);});
 await teste('CAS de recebimento preserva vínculo e classificação ao editar versão atual',async()=>{const antes=await get('rec','extra'),novo={...antes,forma:'PIX'};await db.query('select bsq_gravar_registro_cas($1,$2,$3::jsonb,$4::jsonb)',['rec','extra',JSON.stringify(antes),JSON.stringify(novo)]);assert.deepEqual(await get('rec','extra'),novo);});
 await teste('política de títulos pendente não desconfirma parcela manual conferida',async()=>{const manual={tid:'man-conferida',origem:'manual',valor:50,venc:'2027-01-01',conferir:false},v=await get('venda','v3');v.parcelas.push(manual);await put('venda','v3',v);const p=pedido();p.politica='pendente';await call(p);assert.deepEqual((await get('venda','v1')).parcelas.find(p=>p.tid==='man-conferida'),manual);});
 const conciliar=async(tid,dest='v1')=>{const t=await get('titulo','CONTA_A_RECEBER-'+tid),v=await get('venda',dest);return db.query("select bsq_conciliar_financeiro('titulo',$1,$2,'origem','','','Conferido em documento fictício','Operador fictício',$3,$4::jsonb)",[tid,dest,'concil-ficticia-'+(++n),JSON.stringify({titulo:t.atualizadoEm,venda:v.atualizadoEm})]);};
 const vincular=(tid,dest='v1')=>db.query('select bsq_vincular_titulo($1,$2,$3,$4)',[tid,dest,'Operador fictício','Documento fictício']);
 await teste('vínculo legado não destrói distribuição multitítulo preservada pelo grupo',async()=>{const r=await get('rec','r1');r.alocacoes=[{tid:'t1',valor:40},{tid:'t2',valor:60}];await put('rec','r1',r);await call();const antes=await snapshot();await assert.rejects(vincular('t1'),/distribu|parcelas/i);assert.equal(await snapshot(),antes);});
 for(const [nome,associar] of [['conciliação',conciliar],['vínculo legado',vincular]]){
  await teste(nome+' recusa destino incorporado',async()=>{await put('venda','v2',{...(await get('venda','v2')),incorporadaEmVendaId:'v1'});await assert.rejects(associar('t3','v2'),/incorpor|indispon|principal/i);});
  await teste(nome+' recusa título sem venda e não move seus recebimentos',async()=>{await put('titulo','CONTA_A_RECEBER-t3',{...(await get('titulo','CONTA_A_RECEBER-t3')),classificacaoVinculo:{tipo:'sem_venda'}});const antes=await snapshot();await assert.rejects(associar('t3'),/sem venda|classifica/i);assert.equal(await snapshot(),antes);});
  await teste(nome+' preserva parcelas históricas dos incorporados',async()=>{await call();const antes=(await get('venda','v2')).parcelas;await associar('t1');assert.deepEqual((await get('venda','v2')).parcelas,antes);});
  await teste(nome+' encerra classificação pendente após decisão humana',async()=>{for(const [col,id] of [['titulo','CONTA_A_RECEBER-t3'],['rec','extra']])await put(col,id,{...(await get(col,id)),classificacaoVinculo:{tipo:'pendente'}});await associar('t3');assert.equal((await get('titulo','CONTA_A_RECEBER-t3')).classificacaoVinculo,undefined);assert.equal((await get('rec','extra')).classificacaoVinculo,undefined);});
 }
 await teste('agrupamento encerra classificação pendente após seleção humana',async()=>{for(const [col,id] of [['titulo','CONTA_A_RECEBER-t3'],['rec','extra']])await put(col,id,{...(await get(col,id)),classificacaoVinculo:{tipo:'pendente'}});await call();assert.equal((await get('titulo','CONTA_A_RECEBER-t3')).classificacaoVinculo,undefined);assert.equal((await get('rec','extra')).classificacaoVinculo,undefined);});
 await db.close();console.log(passaram+' passaram; '+falhas+' falharam');if(falhas)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
