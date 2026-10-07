const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ts=require((process.env.BSQ_TEST_DEPS||'../seed/devtools')+'/node_modules/typescript');
const fonte=fs.readFileSync('supabase/functions/bsq-omie/index.ts','utf8');
const compilado=ts.transpileModule(fonte,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const clone=x=>JSON.parse(JSON.stringify(x));
function ambiente(responder, anteriores=[]) {
  const registros=new Map(),requisicoes=[],finalizacoes=[];
  const ultima='2026-10-01T12:00:00.000Z';
  const metas=new Map([['omie_sync',{quando:ultima,status:'completa',pendencias:anteriores}],['omie_referencias',{quando:new Date().toISOString(),contas:{}}]]);
  let handler;
  const dados={agora:()=>new Date().toISOString(),lerCfgBruta:async()=>({omie:{corteEntradas:'2025-01-01'}}),lerColecaoBruta:async()=>[],lerCampos:async()=>[],lerPorIds:async()=>new Map(),
    lerUm:async()=>null,gravarUm:async(c,id,r)=>registros.set(c+'|'+id,clone(r)),gravarVarios:async xs=>{for(const x of xs)registros.set(x.colecao+'|'+x.id,clone(x.registro));},
    marcarMudanca:async()=>{},registrarLog:async()=>{},guardarIndiceNumero:async()=>{},proximoNumero:async()=>1,
    db:{rpc:async(n,p)=>{if(n==='bsq_omie_reservar')return{data:{adquirido:true,inicio:new Date().toISOString(),pagina:1,parcial:{},completa:false,lease:'teste'}};
      if(n==='bsq_omie_finalizar'){finalizacoes.push(p);return{data:true}}return{data:{}}},
      from:()=>({select(){return this},eq(_k,v){this.k=v;return this},maybeSingle:async function(){return{data:metas.has(this.k)?{valor:clone(metas.get(this.k))}:null}},upsert:async x=>{metas.set(x.chave,clone(x.valor));return{}},delete(){return this}})}};
  const ctx={console:{error(){},warn(){}},Request,Response,AbortSignal,Date,Map,Set,JSON,Number,String,Object,Math,Promise,
    Deno:{env:{get:()=> 'token'},serve:f=>handler=f},exports:{},
    fetch:async(_u,o)=>{const b=JSON.parse(o.body);requisicoes.push(b);const r=await responder(b,o);return r instanceof Response?r:new Response(JSON.stringify(r));},
    require:p=>p.includes('dados')?dados:p.includes('cors')?{json:(b,s=200)=>new Response(JSON.stringify(b),{status:s}),preflight:()=>null}:{identificar:async()=>({perfil:'direcao',proprio:true,nome:'Teste'}),perfilDe:q=>q.perfil}};
  vm.createContext(ctx);vm.runInContext(compilado,ctx);
  const chamar=async body=>{const r=await handler(new Request('https://teste.invalid',{method:'POST',headers:{'x-token':'token'},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()}};
  return{registros,requisicoes,metas,ultima,finalizacoes,ctx,chamar,sync:()=>chamar({action:'sincronizar'})};
}
const vazio=b=>b.call==='ListarClientes'?{clientes_cadastro:[],total_de_paginas:1,total_de_registros:0}:{movimentos:[],nTotPaginas:1,nTotRegistros:0};
const casos=[];const caso=(nome,f)=>casos.push([nome,f]);
const falhaPreservada=async responder=>{const a=ambiente(responder);const r=await a.sync();assert.equal(r.status,500,JSON.stringify(r.body));assert.equal(a.metas.get('omie_sync').status,'falhou');assert.equal(a.metas.get('omie_sync').quando,a.ultima);assert.ok(a.finalizacoes.at(-1).p_erro);assert.equal(a.finalizacoes.at(-1).p_pagina,1);assert.equal(a.registros.size,0);return a};
caso('fault HTTP 200 não conclui nem avança cursor',()=>falhaPreservada(b=>b.call==='ListarMovimentos'?{faultcode:'SOAP-ENV:Client',faultstring:'Limite de consumo'}:vazio(b)));
caso('faultcode sem descrição também é erro',()=>falhaPreservada(b=>b.call==='ListarMovimentos'?{faultcode:'SOAP-ENV:Client',nTotPaginas:1,movimentos:[]}:vazio(b)));
caso('JSON inválido não apaga o estado nem conclui',()=>falhaPreservada(b=>b.call==='ListarMovimentos'?new Response('<html>indisponível</html>'):vazio(b)));
caso('lista de movimentos ausente não é sucesso vazio',()=>falhaPreservada(b=>b.call==='ListarMovimentos'?{nTotPaginas:1,nTotRegistros:4}:vazio(b)));
caso('total de páginas ausente não encerra sincronização',()=>falhaPreservada(b=>b.call==='ListarMovimentos'?{movimentos:[]}:vazio(b)));
caso('página vazia intermediária é falha de integridade',()=>falhaPreservada(b=>b.call==='ListarMovimentos'?{movimentos:[],nTotPaginas:2,nTotRegistros:10}:vazio(b)));
caso('total positivo sem registros não é sucesso vazio',()=>falhaPreservada(b=>b.call==='ListarMovimentos'?{movimentos:[],nTotPaginas:1,nTotRegistros:10}:vazio(b)));
caso('total explícito zero sem lista é resposta vazia legítima',async()=>{const a=ambiente(b=>b.call==='ListarClientes'?{total_de_paginas:0,total_de_registros:0}:{nTotPaginas:0,nTotRegistros:0});assert.equal((await a.sync()).status,200);assert.equal(a.metas.get('omie_sync').status,'completa')});
caso('clientes após a quinta página são importados',async()=>{const a=ambiente(b=>b.call==='ListarClientes'?{pagina:b.param[0].pagina,total_de_paginas:6,clientes_cadastro:[{codigo_cliente_omie:b.param[0].pagina,cnpj_cpf:String(10000000000+b.param[0].pagina),razao_social:'Cliente '+b.param[0].pagina,tags:[{tag:'Cliente'}]}]}:vazio(b));assert.equal((await a.sync()).status,200);assert.equal(a.requisicoes.filter(b=>b.call==='ListarClientes').length,6);assert.ok(a.registros.has('cliente|10000000006'));assert.equal(a.metas.get('omie_clientes').mapaCpf['10000000006'],6)});
caso('paginação incompleta de clientes preserva o mapa anterior',async()=>{const a=await falhaPreservada(b=>b.call==='ListarClientes'?b.param[0].pagina===1?{pagina:1,total_de_paginas:2,clientes_cadastro:[{cnpj_cpf:'123',tags:[{tag:'Cliente'}]}]}:{pagina:2,total_de_paginas:2,total_de_registros:2}:vazio(b));assert.equal(a.metas.has('omie_clientes'),false)});
caso('resposta de outra página não passa silenciosamente',()=>falhaPreservada(b=>b.call==='ListarClientes'?{pagina:2,total_de_paginas:2,clientes_cadastro:[{}]}:vazio(b)));
caso('todas as chamadas Omie têm limite de espera',async()=>{const a=ambiente((b,o)=>{assert.ok(o.signal,'chamada sem timeout');return vazio(b)});assert.equal((await a.sync()).status,200)});
caso('espera expirada falha sem avançar a última sincronização',async()=>{
  const prazos=[];
  const a=ambiente((b,o)=>b.call==='ListarClientes'?vazio(b):new Promise((_resolve,reject)=>{o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true})}));
  a.ctx.AbortSignal={timeout:ms=>{prazos.push(ms);return AbortSignal.timeout(5)},any:signals=>AbortSignal.any(signals)};
  // O relógio real mantém o processo vivo enquanto o abort simulado dispara.
  const guarda=setTimeout(()=>{},1000);
  try{const r=await a.sync();assert.equal(r.status,500);assert.equal(a.metas.get('omie_sync').status,'falhou');assert.equal(a.metas.get('omie_sync').quando,a.ultima);assert.ok(prazos.includes(25000));assert.ok(prazos.includes(60000));assert.equal(a.finalizacoes.at(-1).p_pagina,1)}finally{clearTimeout(guarda)}
});
caso('pendências idênticas saem uma vez, eventos diferentes permanecem',async()=>{const p={titulo:8,tipo:'vinculo',valor:100,data:'2026-10-07'};const a=ambiente(vazio,[p,p,p,p,p,{data:p.data,valor:p.valor,tipo:p.tipo,titulo:p.titulo},{...p,valor:101},{...p,data:'2026-10-08'}]);assert.equal((await a.sync()).status,200);assert.equal(a.metas.get('omie_sync').pendencias.length,3)});
caso('pendências novas repetidas não voltam no retorno nem no banco',async()=>{const m={detalhes:{nCodTitulo:55,cGrupo:'CONTA_A_RECEBER',cCPFCNPJCliente:'123',cStatus:'ABERTO',nValorTitulo:100,dDtVenc:'07/10/2026'},resumo:{nValPago:0}};const a=ambiente(b=>b.call==='ListarClientes'?vazio(b):{nTotPaginas:1,movimentos:[m,m,{...m,detalhes:{...m.detalhes,dDtVenc:'08/10/2026'}}]});const r=await a.sync();assert.equal(r.status,200);assert.equal(r.body.pendencias.length,2);assert.equal(a.metas.get('omie_sync').pendencias.length,2)});
caso('saúde resumida limita amostra e mantém contagens exatas e legado',async()=>{
  const pendencias=[...Array.from({length:3000},(_,titulo)=>({titulo,tipo:'vinculo'})),...Array.from({length:28},(_,titulo)=>({titulo,tipo:'possivel_duplicidade'})),...Array.from({length:9},(_,titulo)=>({titulo,tipo:'sem_data'}))];
  const a=ambiente(vazio,pendencias);const meta=a.metas.get('omie_sync');meta.pendenciasParciais=pendencias;meta.pendenciasVendas=Array.from({length:7},(_,i)=>({id:i}));meta.contagens={recNovos:17};
  const r=await a.chamar({action:'saude',resumida:true});assert.equal(r.status,200);assert.equal(r.body.sync.quando,a.ultima);assert.equal(r.body.sync.contagens.recNovos,17);assert.equal(r.body.sync.pendencias.length,12);
  assert.deepEqual(r.body.sync.pendenciasResumo,{total:3037,vinculo:3000,possivel_duplicidade:28,outros:9});assert.equal(r.body.sync.pendenciasVendas.length,4);assert.equal(r.body.sync.pendenciasVendasTotal,7);assert.equal(r.body.sync.pendenciasParciais,undefined);
  const legado=await a.chamar({action:'saude'});assert.equal(legado.body.sync.pendencias.length,3037);assert.equal(legado.body.sync.pendenciasParciais.length,3037);assert.equal(legado.body.sync.pendenciasVendas.length,7);assert.equal(a.requisicoes.length,0);
});
(async()=>{let falhas=0;for(const[n,f]of casos){try{await f();console.log('OK '+n)}catch(e){falhas++;console.error('FALHOU '+n+': '+e.message)}}assert.equal(falhas,0,falhas+' casos falharam');console.log('PASSOU '+casos.length+' casos de integridade do conector Omie')})().catch(()=>process.exit(1));
