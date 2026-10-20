// Janela incremental ancorada no INÍCIO da rodada, releitura completa semanal,
// estado da rodada na saúde e referências antigas quando o Omie falha.
// Mesmo arcabouço de testar-omie-v2.cjs (função transpilada, banco em memória).
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require((process.env.BSQ_TEST_DEPS || '../seed/devtools')+'/node_modules/typescript');
const clone=x=>JSON.parse(JSON.stringify(x));const registros=new Map(),metas=new Map(),reservas=[],requisicoes=[];let handler,numero=0,omieFora=false;
const key=(c,id)=>c+'|'+id;
const execucao={inicio:null,pagina:1,completa:false,reservado_ate:null,proxima:'2026-10-20T12:15:00.000Z',ultimo_erro:'falha anterior',tentativas:2,falhando_desde:'2026-10-20T11:00:00.000Z'};
const cfg={omie:{corteEntradas:'2026-01-01'}};
const tabela=t=>({t,select(){return this},eq(k,v){this.v=v;return this},
 maybeSingle:async function(){if(this.t==='bsq_omie_execucao')return{data:clone(execucao)};return{data:metas.has(this.v)?{valor:clone(metas.get(this.v))}:null}},
 upsert:async function(x){metas.set(x.chave,clone(x.valor));return{error:null}},delete(){return this}});
const dados={agora:()=>new Date().toISOString(),lerCfgBruta:async()=>clone(cfg),lerColecaoBruta:async c=>[...registros].filter(([k])=>k.startsWith(c+'|')).map(([,r])=>({registro:clone(r)})),
 lerCampos:async()=>[],lerPorIds:async(c,ids)=>new Map(ids.filter(id=>registros.has(key(c,id))).map(id=>[id,clone(registros.get(key(c,id)))])),lerUm:async()=>null,
 gravarUm:async(c,id,r)=>registros.set(key(c,id),clone(r)),gravarVarios:async xs=>{for(const x of xs)registros.set(key(x.colecao,x.id),clone(x.registro));},
 marcarMudanca:async()=>{},registrarLog:async()=>{},guardarIndiceNumero:async()=>{},proximoNumero:async()=>++numero,
 db:{rpc:async(nome,p)=>{if(nome==='bsq_omie_reservar'){reservas.push(p);return{data:{adquirido:true,inicio:'2026-10-20T12:00:00.000Z',pagina:1,parcial:{},completa:p.p_completa,lease:'teste'}};}
  if(nome==='bsq_omie_finalizar')return{data:true};return{data:{vendasNovas:0,pagamentosVinculados:0,titulos:0,pagamentos:0}};},from:tabela}};
const resposta=b=>b.call==='ListarContasCorrentes'?{ListarContasCorrentes:[{nCodCC:1,descricao:'Conta'}],total_de_paginas:1}:b.call==='ListarCategorias'?{categoria_cadastro:[{codigo:'1',descricao:'C'}],total_de_paginas:1}:
 b.call==='ListarDepartamentos'?{departamentos:[{codigo:'1',descricao:'D'}],total_de_paginas:1}:b.call==='ListarClientes'?{clientes_cadastro:[],total_de_registros:0,total_de_paginas:0}:{nPagina:1,nTotPaginas:1,nTotRegistros:0,movimentos:[]};
const ctx={console:{...console,warn(){},error(){}},Request,Response,AbortSignal,Date,Map,Set,JSON,Number,String,Object,Math,Promise,Deno:{env:{get:()=>'token'},serve:f=>handler=f},exports:{},
 fetch:async(_u,o)=>{const b=JSON.parse(o.body);requisicoes.push(b);if(omieFora)return new Response('{"faultstring":"fora do ar"}',{status:500});return new Response(JSON.stringify(resposta(b)),{status:200})},
 require:p=>p.includes('dados')?dados:p.includes('cors')?{json:(b,s=200)=>new Response(JSON.stringify(b),{status:s}),preflight:()=>null}:{identificar:async()=>({perfil:'direcao',proprio:true,nome:'Teste'}),perfilDe:q=>q.perfil}};
vm.createContext(ctx);vm.runInContext(ts.transpileModule(fs.readFileSync('supabase/functions/bsq-omie/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const chamar=async(corpo,headers={'x-token':'token'})=>{const r=await handler(new Request('https://teste.invalid',{method:'POST',headers,body:JSON.stringify(corpo)}));return{status:r.status,b:await r.json()};};
const automatico=()=>chamar({action:'sincronizar',automatico:true},{'x-rotina-token':'token'});
const manual=()=>chamar({action:'sincronizar'});
const janelaUsada=()=>{const l=requisicoes.filter(x=>x.call==='ListarMovimentos').pop();return l&&l.param[0].dDtAltDe;};
const brMenos3=iso=>{const d=new Date(Date.parse(iso)-3*86400e3).toISOString().slice(0,10).split('-');return d[2]+'/'+d[1]+'/'+d[0];};
(async()=>{
 // 1) Meta antiga (sem âncora nem releitura): a 1ª rodada automática é COMPLETA e lê tudo.
 metas.set('omie_sync',{quando:'2026-10-20T11:45:00.000Z',status:'completa',pendencias:[]});
 let r=await automatico();assert.equal(r.status,200,JSON.stringify(r.b));
 assert.equal(reservas.at(-1).p_completa,true,'sem releitura registrada, o automático pede rodada completa');
 assert.equal(janelaUsada(),undefined,'rodada completa não usa janela');
 let m=metas.get('omie_sync');assert.equal(m.ancora,'2026-10-20T12:00:00.000Z');assert.equal(m.ultimaCompleta,'2026-10-20T12:00:00.000Z');
 console.log('OK primeira rodada automática depois da publicação é completa e grava âncora e releitura');
 // 2) Releitura recente: incremental, janela parte da ÂNCORA (início), não do fim.
 metas.set('omie_sync',{...m,quando:'2026-10-20T12:30:00.000Z',ancora:'2026-09-17T11:00:00.000Z'});
 r=await automatico();assert.equal(r.status,200,JSON.stringify(r.b));
 assert.equal(reservas.at(-1).p_completa,false);assert.equal(janelaUsada(),brMenos3('2026-09-17T11:00:00.000Z'),'janela ancorada no início da rodada anterior');
 assert.equal(metas.get('omie_sync').ultimaCompleta,'2026-10-20T12:00:00.000Z','incremental não mexe na data da releitura completa');
 console.log('OK janela incremental ancorada no início da rodada (rodada longa não deixa buraco)');
 // 3) Sem âncora (meta de antes desta versão): cai para "quando", como antes.
 metas.set('omie_sync',{quando:'2026-10-19T10:00:00.000Z',ultimaCompleta:'2026-10-18T00:00:00.000Z',status:'completa',pendencias:[]});
 await automatico();assert.equal(janelaUsada(),brMenos3('2026-10-19T10:00:00.000Z'));
 console.log('OK meta sem âncora continua usando a última conclusão');
 // 4) Releitura vencida (mais de 7 dias): volta a ser completa. Manual nunca força.
 metas.set('omie_sync',{quando:'2026-10-19T10:00:00.000Z',ancora:'2026-10-19T09:50:00.000Z',ultimaCompleta:'2026-10-01T00:00:00.000Z',status:'completa',pendencias:[]});
 await manual();assert.equal(reservas.at(-1).p_completa,false,'sincronização pela tela não vira releitura completa');
 metas.set('omie_sync',{quando:'2026-10-19T10:00:00.000Z',ancora:'2026-10-19T09:50:00.000Z',ultimaCompleta:'2026-10-01T00:00:00.000Z',status:'completa',pendencias:[]});
 await automatico();assert.equal(reservas.at(-1).p_completa,true,'releitura com mais de 7 dias');
 metas.set('omie_sync',{quando:'2026-10-19T10:00:00.000Z',ultimaCompleta:'data-invalida',status:'completa',pendencias:[]});
 await automatico();assert.equal(reservas.at(-1).p_completa,true,'data inválida conta como vencida');
 console.log('OK releitura semanal automática; sincronização manual continua incremental');
 // 5) Saúde devolve o estado da rodada (falhas seguidas, desde quando, próxima tentativa).
 r=await chamar({action:'saude',resumida:true});assert.equal(r.status,200);
 assert.equal(r.b.execucao.tentativas,2);assert.equal(r.b.execucao.falhando_desde,'2026-10-20T11:00:00.000Z');assert.equal(r.b.execucao.ultimo_erro,'falha anterior');assert.ok(r.b.agora);
 console.log('OK saúde devolve tentativas, falhando desde e último erro');
 // 6) Referências: com o Omie fora, devolve a cópia anterior marcada como desatualizada.
 metas.set('omie_referencias',{quando:'2026-10-01T00:00:00.000Z',contas:{1:'Conta'},categorias:{},centros:{},pessoas:{}});omieFora=true;
 r=await chamar({action:'referencias',forcar:true});assert.equal(r.status,200,JSON.stringify(r.b));assert.equal(r.b.desatualizado,true);assert.equal(r.b.quando,'2026-10-01T00:00:00.000Z');
 metas.delete('omie_referencias');r=await chamar({action:'referencias',forcar:true});assert.equal(r.status,500,'sem cópia anterior, o erro aparece');
 omieFora=false;console.log('OK referências antigas servem quando o Omie está fora');
 // 7) Página inválida explica o formato recebido (só números e nomes de campo).
 const resp=ctx.fetch;ctx.fetch=async(u,o)=>{const b=JSON.parse(o.body);if(b.call==='ListarMovimentos')return new Response(JSON.stringify({nPagina:1,nTotPaginas:0,nTotRegistros:5}),{status:200});return resp(u,o);};
 metas.set('omie_sync',{quando:'2026-10-19T10:00:00.000Z',ancora:'2026-10-19T09:50:00.000Z',ultimaCompleta:'2026-10-19T00:00:00.000Z',status:'completa',pendencias:[]});
 r=await automatico();assert.equal(r.status,500);assert.match(r.b.error,/nPagina=1 nTotPaginas=0 nTotRegistros=5 movimentos=undefined/);
 console.log('OK erro de página inválida mostra o formato recebido');
 console.log('PASSOU: âncora no início da rodada, releitura completa semanal, saúde com falhas seguidas, referências antigas e diagnóstico de página.');
})().catch(e=>{console.error(e);process.exit(1)});
