// O que a releitura completa (reparo do buraco de 17/09 a 30/09 e depois toda
// semana) NÃO pode fazer: lançar em dobro a parcela já baixada à mão, apagar a
// observação escrita por uma pessoa, trocar forma/origem de despesa conciliada,
// travar numa página que sumiu, ressuscitar lançamento apagado de propósito.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require((process.env.BSQ_TEST_DEPS || '../seed/devtools')+'/node_modules/typescript');
const clone=x=>JSON.parse(JSON.stringify(x));const registros=new Map(),metas=new Map(),finais=[],reservas=[],pedidos=[];let handler,numero=0;
const key=(c,id)=>c+'|'+id;
let reserva={inicio:'2026-10-20T03:00:00.000Z',pagina:1,completa:true};
let paginas={1:[]},totalPaginas=1;
const cfg={omie:{corteEntradas:'2026-01-01'}};
const tabela=t=>({t,select(){return this},eq(k,v){this.v=v;return this},maybeSingle:async function(){return{data:metas.has(this.v)?{valor:clone(metas.get(this.v))}:null}},
 upsert:async function(x){metas.set(x.chave,clone(x.valor));return{error:null}},delete(){return this}});
const dados={agora:()=>new Date().toISOString(),lerCfgBruta:async()=>clone(cfg),lerColecaoBruta:async c=>[...registros].filter(([k])=>k.startsWith(c+'|')).map(([,r])=>({registro:clone(r)})),
 lerCampos:async(c,campos)=>[...registros].filter(([k])=>k.startsWith(c+'|')).map(([k,r])=>({id:k.slice(c.length+1),...Object.fromEntries(campos.map(f=>[f,r[f]==null?null:String(r[f])]))})),
 lerPorIds:async(c,ids)=>new Map(ids.filter(id=>registros.has(key(c,id))).map(id=>[id,clone(registros.get(key(c,id)))])),lerUm:async(c,id)=>registros.has(key(c,id))?clone(registros.get(key(c,id))):null,
 gravarUm:async(c,id,r)=>registros.set(key(c,id),clone(r)),gravarVarios:async xs=>{for(const x of xs)registros.set(key(x.colecao,x.id),clone(x.registro));},
 marcarMudanca:async()=>{},registrarLog:async()=>{},guardarIndiceNumero:async()=>{},proximoNumero:async()=>++numero,
 db:{rpc:async(nome,p)=>{if(nome==='bsq_financeiro_revisao')return{data:0};if(nome==='bsq_omie_aplicar_pagina'){assert.equal(p.p_revisao,0);assert.ok(Array.isArray(p.p_itens));for(const x of p.p_itens)registros.set(x.colecao+'|'+x.id,clone(x.registro));return{data:{ok:true}};}if(nome==='bsq_omie_reservar'){reservas.push(p);return{data:{adquirido:true,lease:'t',parcial:{},...reserva}};}
  if(nome==='bsq_omie_finalizar'){finais.push(p);return{data:true};}return{data:{vendasNovas:0,pagamentosVinculados:0,titulos:0,pagamentos:0}};},from:tabela}};
const resposta=b=>{if(b.call==='ListarMovimentos'){pedidos.push(b.param[0].nPagina);const n=b.param[0].nPagina;if(n>totalPaginas)return{nPagina:n,nTotPaginas:totalPaginas,nTotRegistros:totalPaginas*100};return{nPagina:n,nTotPaginas:totalPaginas,nTotRegistros:Math.max(1,(paginas[n]||[]).length),movimentos:paginas[n]||[]};}
 return b.call==='ListarContasCorrentes'?{ListarContasCorrentes:[],total_de_registros:0,total_de_paginas:0}:b.call==='ListarCategorias'?{categoria_cadastro:[],total_de_registros:0}:b.call==='ListarDepartamentos'?{departamentos:[],total_de_registros:0}:{clientes_cadastro:[],total_de_registros:0,total_de_paginas:0};};
const ctx={console:{...console,warn(){},error(){}},Request,Response,AbortSignal,Date,Map,Set,JSON,Number,String,Object,Math,Promise,Deno:{env:{get:()=>'token'},serve:f=>handler=f},exports:{},
 fetch:async(_u,o)=>new Response(JSON.stringify(resposta(JSON.parse(o.body))),{status:200}),
 require:p=>p.includes('classificacao-vinculo')?require('./carregar-helper-ts.cjs')('classificacao-vinculo'):p.includes('dados')?dados:p.includes('cors')?{json:(b,s=200)=>new Response(JSON.stringify(b),{status:s}),preflight:()=>null}:{identificar:async()=>({perfil:'direcao',proprio:true,nome:'Teste'}),perfilDe:q=>q.perfil}};
vm.createContext(ctx);vm.runInContext(ts.transpileModule(fs.readFileSync('supabase/functions/bsq-omie/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const chamar=async(corpo,headers)=>{const r=await handler(new Request('https://teste.invalid',{method:'POST',headers,body:JSON.stringify(corpo)}));return{status:r.status,b:await r.json()};};
const automatico=()=>chamar({action:'sincronizar',automatico:true},{'x-rotina-token':'token'});
const manual=()=>chamar({action:'sincronizar'},{'x-token':'token'});
const recebido=(tid,cpf,valor,pagto)=>({detalhes:{nCodTitulo:tid,cGrupo:'CONTA_A_RECEBER',cStatus:'RECEBIDO',nValorTitulo:valor,cCPFCNPJCliente:cpf,dDtVenc:'20/09/2026',dDtPagamento:pagto},resumo:{cLiquidado:'S',nValPago:valor,nValLiquido:valor,nValAberto:0}});
const pago=(tid,valor,pagto)=>({detalhes:{nCodTitulo:tid,cGrupo:'CONTA_A_PAGAR',cStatus:'PAGO',nValorTitulo:valor,dDtPagamento:pagto,cCodCateg:'2.01'},resumo:{cLiquidado:'S',nValPago:valor,nValLiquido:valor}});
(async()=>{
 metas.set('omie_sync',{quando:'2026-10-20T02:50:00.000Z',ancora:'2026-10-20T02:45:00.000Z',ultimaCompleta:'2026-10-19T03:00:00.000Z',status:'completa',pendencias:[]});
 registros.set(key('venda','v1'),{id:'v1',clienteId:'111',parcelas:[{tid:901,valor:500,venc:'2026-09-20'},{tid:902,valor:500,venc:'2026-10-20'}]});
 // Parcela 901 baixada à mão e amarrada; parcela 902 sem baixa manual.
 registros.set(key('rec','m1'),{id:'m1',codigo:'RB-0001',vendaId:'v1',valor:500,data:'2026-09-25',alocacoes:[{tid:'901',valor:500}]});
 // Recebimento do Omie com observação escrita por uma pessoa.
 registros.set(key('rec','rbomie-903'),{id:'rbomie-903',numero:7,vendaId:'v1',valor:500,data:'2026-08-20',obs:'cliente trouxe em mãos, ver recibo',omie:{titulo:903}});
 // Despesa lançada à mão e conciliada com o título Omie 950.
 registros.set(key('cx','manual-1'),{id:'manual-1',tipo:'saida',valor:80,data:'2026-09-02',forma:'PIX',origem:'planilha',vinculoOmieConfirmado:true,omie:{titulo:'950'}});
 // Recebimento do Omie que uma PESSOA apagou e que já virou lápide.
 registros.set(key('rec','rbomie-904'),{id:'rbomie-904',apagadoEm:'2026-06-01T00:00:00.000Z',apagadoPor:'Leonardo',lapide:true,valor:500,data:'2026-05-20',omie:{titulo:904}});
 paginas={1:[recebido(901,'111',500,'25/09/2026'),recebido(902,'111',500,'22/09/2026'),recebido(903,'111',500,'20/08/2026'),recebido(904,'111',500,'20/05/2026'),pago(950,80,'03/09/2026')]};
 let r=await automatico();assert.equal(r.status,200,JSON.stringify(r.b));
 assert.ok(!registros.has(key('rec','rbomie-901')),'parcela já baixada à mão não ganha o recebimento do Omie em dobro');
 const pend=metas.get('omie_sync').pendencias;
 assert.ok(pend.some(p=>p.tipo==='recebimento_manual'&&String(p.titulo)==='901'&&p.candidatos[0]==='m1'),'vira conferência com o lançamento manual indicado');
 assert.equal(registros.get(key('rec','rbomie-902')).valor,500,'parcela sem baixa manual recebe o recebimento do Omie (o reparo)');
 console.log('OK reparo: parcela baixada à mão vira conferência; parcela sem baixa recebe o recebimento');
 assert.equal(registros.get(key('rec','rbomie-903')).obs,'cliente trouxe em mãos, ver recibo');
 assert.match(registros.get(key('rec','rbomie-902')).obs,/^baixa automática do Omie/);
 console.log('OK observação escrita por uma pessoa sobrevive à releitura');
 const cx=registros.get(key('cx','manual-1'));assert.equal(cx.forma,'PIX');assert.equal(cx.origem,'planilha');assert.equal(cx.data,'2026-09-02');assert.ok(!registros.has(key('cx','cxomie-950')));
 console.log('OK despesa conciliada mantém forma, origem e data de quem lançou');
 const lap=registros.get(key('rec','rbomie-904'));assert.ok(lap.apagadoEm&&lap.lapide,'lápide de recebimento apagado de propósito não ressuscita');
 console.log('OK lançamento do Omie apagado de propósito (lápide) não volta');
 // Releitura completa disparada pela tela: 3 páginas por chamada, não 15.
 totalPaginas=10;paginas={};for(let i=1;i<=10;i++)paginas[i]=[pago(2000+i,10,'03/09/2026')];
 reserva={inicio:'2026-10-20T03:00:00.000Z',pagina:1,completa:true};pedidos.length=0;
 r=await manual();assert.equal(r.status,200,JSON.stringify(r.b));assert.deepEqual(pedidos,[1,2,3]);assert.equal(r.b.continua,4);
 reserva={inicio:null,pagina:1,completa:false};pedidos.length=0;metas.set('omie_sync',{...metas.get('omie_sync'),ultimaCompleta:new Date().toISOString()});
 r=await manual();assert.equal(pedidos.length,10,'incremental pela tela segue com até 15 páginas');
 console.log('OK releitura completa lê 3 páginas por chamada também pela tela');
 // Rodada retomada numa página que sumiu: recomeça da 1, mantendo a rodada.
 totalPaginas=3;paginas={1:[],2:[],3:[]};reserva={inicio:'2026-10-20T03:00:00.000Z',pagina:5,completa:true};finais.length=0;
 r=await automatico();assert.equal(r.status,200,JSON.stringify(r.b));assert.equal(finais.at(-1).p_pagina,1);assert.equal(finais.at(-1).p_erro,null);assert.equal(r.b.continua,1);
 console.log('OK página que sumiu numa rodada retomada recomeça da página 1 sem erro');
 // Releitura vencida: com mais de 8 dias começa na hora; entre 6,5 e 8 dias, só de madrugada.
 reserva={inicio:null,pagina:1,completa:false};totalPaginas=1;paginas={1:[]};
 metas.set('omie_sync',{...metas.get('omie_sync'),ultimaCompleta:new Date(Date.now()-9*86400e3).toISOString()});await automatico();assert.equal(reservas.at(-1).p_completa,true);
 metas.set('omie_sync',{...metas.get('omie_sync'),ultimaCompleta:new Date(Date.now()-7*86400e3).toISOString()});await automatico();
 const madrugada=(new Date().getUTCHours()+21)%24<6;assert.equal(reservas.at(-1).p_completa,madrugada);
 metas.set('omie_sync',{...metas.get('omie_sync'),ultimaCompleta:new Date(Date.now()-2*86400e3).toISOString()});await automatico();assert.equal(reservas.at(-1).p_completa,false);
 console.log('OK releitura semanal: madrugada entre 6,5 e 8 dias, na hora depois de 8 dias, nunca antes de 6,5');
 // Lápides: rotina e Esvaziar não apagam de vez espelho do Omie apagado por pessoa.
 const lix=ts.transpileModule(fs.readFileSync('supabase/functions/_shared/lixeira.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const m={exports:{}};new Function('exports','module',lix)(m.exports,m);
 assert.equal(m.exports.precisaLapide('rbomie-1',{apagadoEm:'x',apagadoPor:'Leonardo'}),true);
 assert.equal(m.exports.precisaLapide('cxomie-1',{apagadoEm:'x',apagadoPor:'omie'}),false,'o que o próprio Omie estornou pode sumir');
 assert.equal(m.exports.precisaLapide('m1',{apagadoEm:'x',apagadoPor:'Leonardo'}),false);
 const l=m.exports.lapideDe({id:'rbomie-1',apagadoEm:'a',apagadoPor:'P',valor:5,data:'d',obs:'x',anexos:[{arquivoId:'z'}],omie:{titulo:1,original:{grande:true}}});
 assert.deepEqual(Object.keys(l).sort(),['apagadoEm','apagadoPor','atualizadoEm','data','id','lapide','omie','valor']);assert.deepEqual(l.omie,{titulo:1});
 for(const f of ['supabase/functions/bsq-rotina/index.ts','supabase/functions/bsq-nucleo/index.ts']){const src=fs.readFileSync(f,'utf8');assert.match(src,/precisaLapide\(linha\.id, o\)\) \{ await gravarUm\(linha\.colecao, linha\.id, lapideDe\(o\)\)/,f);}
 assert.match(fs.readFileSync('supabase/functions/bsq-nucleo/index.ts','utf8'),/if \(r\.lapide\) return json/);
 console.log('OK lápide no lugar de apagar de vez (rotina e botão Esvaziar), sem restaurar lápide');
 console.log('PASSOU: reparo sem duplicar baixa manual, observação e despesa conciliada preservadas, lápides, 3 páginas na releitura, página sumida e janela de madrugada.');
})().catch(e=>{console.error(e);process.exit(1)});
