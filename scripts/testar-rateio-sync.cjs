const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require((process.env.BSQ_TEST_DEPS || '../seed/devtools')+'/node_modules/typescript');
const clone=x=>JSON.parse(JSON.stringify(x));const registros=new Map(),metas=new Map();let handler,numero=0;let completa=true;const requisicoes=[];
const key=(c,id)=>c+'|'+id;
registros.set(key('venda','v1'),{id:'v1',clienteId:'123',parcelas:[{tid:1,valor:625,venc:'2026-09-20',conferir:false}]});
registros.set(key('cliente','777'),{id:'777',nome:'Nome editado',email:'manual@example.invalid',atualizadoPor:'Operador'});
registros.set(key('cx','manual'),{id:'manual',tipo:'saida',valor:100,data:'2026-09-05'});
const cfg={omie:{corteEntradas:'2026-01-01'}};
const dados={agora:()=>new Date().toISOString(),lerCfgBruta:async()=>clone(cfg),lerColecaoBruta:async c=>[...registros].filter(([k])=>k.startsWith(c+'|')).map(([,r])=>({registro:clone(r)})),lerCampos:async(c,campos)=>[...registros].filter(([k])=>k.startsWith(c+'|')).map(([k,r])=>({id:k.slice(c.length+1),...Object.fromEntries(campos.map(f=>[f,r[f]==null?null:String(r[f])]))})),lerPorIds:async(c,ids)=>new Map(ids.filter(id=>registros.has(key(c,id))).map(id=>[id,clone(registros.get(key(c,id)))])),lerUm:async(c,id)=>registros.has(key(c,id))?clone(registros.get(key(c,id))):null,
 gravarUm:async(c,id,r)=>registros.set(key(c,id),clone(r)),gravarVarios:async xs=>{for(const x of xs)registros.set(key(x.colecao,x.id),clone(x.registro));},marcarMudanca:async()=>{},registrarLog:async()=>{},guardarIndiceNumero:async()=>{},proximoNumero:async()=>++numero,
 db:{rpc:async(nome,p)=>{if(nome==='bsq_financeiro_revisao')return{data:0};if(nome==='bsq_omie_aplicar_pagina'){assert.equal(p.p_revisao,0);assert.ok(Array.isArray(p.p_itens));for(const x of p.p_itens)registros.set(x.colecao+'|'+x.id,clone(x.registro));return{data:{ok:true}};}return nome==='bsq_omie_reservar'?{data:{adquirido:true,inicio:new Date().toISOString(),pagina:1,parcial:{},completa:p.p_completa,lease:'teste'}}:nome==='bsq_omie_finalizar'?{data:true}:{data:{vendasNovas:0,pagamentosVinculados:0}};},from:()=>({select(){return this},eq(k,v){this.k=v;return this},maybeSingle:async function(){return {data:metas.has(this.k)?{valor:clone(metas.get(this.k))}:null}},upsert:async function(x){metas.set(x.chave,clone(x.valor));return{error:null}},delete(){return this}})}};
let movimentos=[{detalhes:{nCodTitulo:1,cGrupo:'CONTA_A_RECEBER',cStatus:'RECEBIDO',nValorTitulo:625,cCPFCNPJCliente:'123',dDtVenc:'20/09/2026',dDtPagamento:'05/09/2026'},resumo:{cLiquidado:'S',nValPago:625,nValLiquido:500,nDesconto:125,nValAberto:0}}, {detalhes:{nCodTitulo:2,cGrupo:'CONTA_A_PAGAR',cStatus:'PAGO',nValorTitulo:100,dDtPagamento:'05/09/2026'},resumo:{cLiquidado:'S',nValPago:100}}];
const ctx={console,Request,Response,AbortSignal,Date,Map,Set,JSON,Number,String,Object,Math,Promise,Deno:{env:{get:()=> 'token'},serve:f=>handler=f},exports:{},fetch:async(_u,o)=>{const b=JSON.parse(o.body);requisicoes.push(b);return new Response(JSON.stringify(b.call==='ListarContasCorrentes'?{ListarContasCorrentes:[{nCodCC:1,descricao:'Conta principal'}],total_de_paginas:1}:b.call==='ListarCategorias'?{categoria_cadastro:[{codigo:'2.01',descricao:'Materiais'}],total_de_paginas:1}:b.call==='ListarDepartamentos'?{departamentos:[{codigo:'10',descricao:'Administração'}],total_de_paginas:1}:b.call==='ListarClientes'?{clientes_cadastro:[{cnpj_cpf:"987",razao_social:"Novo cliente",tags:[{tag:"Cliente"}],email:"novo@example.invalid"},{cnpj_cpf:"777",razao_social:"Nome do Omie",email:"omie@example.invalid",tags:[{tag:"Cliente"}]},{cnpj_cpf:"888",razao_social:"Fornecedor",tags:[{tag:"Fornecedor"}]}],total_de_paginas:1}:{nTotPaginas:1,movimentos}),{status:200})},require:p=>p.includes('classificacao-vinculo')?require('./carregar-helper-ts.cjs')('classificacao-vinculo'):p.includes('dados')?dados:p.includes('cors')?{json:(b,s=200)=>new Response(JSON.stringify(b),{status:s}),preflight:()=>null}:{identificar:async()=>({perfil:'direcao',proprio:true,nome:'Teste'}),perfilDe:q=>q.perfil}};
vm.createContext(ctx);vm.runInContext(ts.transpileModule(fs.readFileSync('supabase/functions/bsq-omie/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const sync=async()=>{const r=await handler(new Request('https://teste.invalid',{method:'POST',headers:{'x-token':'token'},body:JSON.stringify({action:'sincronizar',completa})}));const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;};

// Somente fixtures; exercita o handler real, com transporte Omie simulado.
(async()=>{
 registros.clear();
 const partes=[{vendaId:'v1',valor:300},{vendaId:'v2',valor:600}];
 const rt={versao:1,operacao:'rateio-teste-sync',titulo:'1',valorTotal:900,venc:'2026-09-20',partes};
 const rr={...rt,data:'2026-09-20'};delete rr.venc;
 for(const p of partes)registros.set('venda|'+p.vendaId,{id:p.vendaId,clienteId:'123',situacao:'ativa',comissao:70,anexos:[{id:'anexo-'+p.vendaId}],parcelas:[{tid:'1',valor:p.valor,valorDia:p.valor,venc:rt.venc,trava:true,conferir:false,vinculoConfirmado:true,rateioVendaId:p.vendaId,rateioContratos:rt}]});
 registros.set('titulo|CONTA_A_RECEBER-1',{id:'CONTA_A_RECEBER-1',titulo:1,cpf:'123',grupo:'CONTA_A_RECEBER',valor:900,venc:rt.venc,rateioContratos:rt});
 registros.set('rec|rbomie-1',{id:'rbomie-1',vendaId:'',valor:900,data:'2026-09-20',omie:{titulo:1},alocacoes:[],rateioContratos:rr,conferir:false});
 movimentos=[{detalhes:{nCodTitulo:1,cGrupo:'CONTA_A_RECEBER',cStatus:'RECEBIDO',nValorTitulo:900,cCPFCNPJCliente:'123',dDtVenc:'20/09/2026',dDtPagamento:'20/09/2026'},resumo:{cLiquidado:'S',nValPago:900,nValLiquido:900,nValAberto:0}}];
 await sync();await sync();
 const core=require('../financeiro-core.js');
 assert.equal([...registros.keys()].filter(k=>k.startsWith('rec|')).length,1);
 for(const p of partes){const v=registros.get('venda|'+p.vendaId);assert.equal(v.parcelas.length,1);assert.equal(v.parcelas[0].valor,p.valor);assert.equal(v.comissao,70);assert.equal(v.anexos.length,1);assert.equal(core.resumo(v,[registros.get('rec|rbomie-1')],'2026-10-01').pago,p.valor);}
 console.log('OK sincronização repetida conserva partes, caixa único, comissões e anexos');
 movimentos[0].detalhes.nValorTitulo=901;movimentos[0].resumo.nValPago=901;movimentos[0].resumo.nValLiquido=901;
 await sync();
 assert.equal(registros.get('rec|rbomie-1').conferir,true);
 for(const p of partes){const v=registros.get('venda|'+p.vendaId);assert.equal(v.parcelas[0].valor,p.valor);assert.equal(v.parcelas[0].venc,rt.venc);assert.equal(v.parcelas[0].conferir,true);}
 console.log('OK diferença da origem gera pendência sem redistribuir automaticamente');
 movimentos[0].detalhes.nValorTitulo=900;movimentos[0].resumo.nValPago=900;movimentos[0].resumo.nValLiquido=900;
 const r=registros.get('rec|rbomie-1');registros.delete('rec|rbomie-1');registros.set('rec|manual-1',{...r,id:'manual-1',valor:900,rateioContratos:rr,conferir:false,alocacoes:[]});
 await sync();assert.equal([...registros.keys()].filter(k=>k.startsWith('rec|')).length,1);assert.ok(registros.has('rec|manual-1'));assert.equal(registros.get('rec|manual-1').valor,900);
 console.log('OK recebimento rateado com ID manual não gera outro lançamento Omie');
 console.log('PASSOU sincronização dos rateios');
})().catch(e=>{console.error(e);process.exit(1)});
