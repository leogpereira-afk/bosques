const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require('../seed/devtools/node_modules/typescript');
const clone=x=>JSON.parse(JSON.stringify(x));const registros=new Map(),metas=new Map();let handler,numero=0;
const key=(c,id)=>c+'|'+id;
const backup=JSON.parse(fs.readFileSync('seed/backup-pre-reconstrucao.json'));
for(const r of backup.registros)registros.set(key(r._col,r.id),clone(r));
const cfg=backup.cfg;
const dados={agora:()=>new Date().toISOString(),lerCfgBruta:async()=>clone(cfg),lerColecaoBruta:async c=>[...registros].filter(([k])=>k.startsWith(c+'|')).map(([,r])=>({registro:clone(r)})),lerUm:async(c,id)=>registros.has(key(c,id))?clone(registros.get(key(c,id))):null,
 gravarUm:async(c,id,r)=>registros.set(key(c,id),clone(r)),gravarVarios:async xs=>{for(const x of xs)registros.set(key(x.colecao,x.id),clone(x.registro));},marcarMudanca:async()=>{},registrarLog:async()=>{},guardarIndiceNumero:async()=>{},proximoNumero:async()=>++numero,
 db:{from:()=>({select(){return this},eq(k,v){this.k=v;return this},maybeSingle:async function(){return {data:metas.has(this.k)?{valor:clone(metas.get(this.k))}:null}},upsert:async function(x){metas.set(x.chave,clone(x.valor));return{error:null}},delete(){return this}})}};
const movimentos=JSON.parse(fs.readFileSync('seed/omie-leitura-reconstrucao.json')).movimentos;
const ctx={console,Request,Response,Date,Map,Set,JSON,Number,String,Object,Math,Promise,Deno:{env:{get:()=> 'token'},serve:f=>handler=f},exports:{},fetch:async(_u,o)=>{const b=JSON.parse(o.body);return new Response(JSON.stringify(b.call==='ListarClientes'?{clientes_cadastro:[],total_de_paginas:1}:{nTotPaginas:Math.ceil(movimentos.length/100),movimentos:movimentos.slice((b.param[0].nPagina-1)*100,b.param[0].nPagina*100)}),{status:200})},require:p=>p.includes('dados')?dados:p.includes('cors')?{json:(b,s=200)=>new Response(JSON.stringify(b),{status:s}),preflight:()=>null}:{identificar:async()=>({perfil:'direcao',proprio:true,nome:'Teste'}),perfilDe:q=>q.perfil}};
vm.createContext(ctx);vm.runInContext(ts.transpileModule(fs.readFileSync('supabase/functions/bsq-omie/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
(async()=>{
let pagina=null,parcial=null,inicio=null,res;
do{const r=await handler(new Request('https://teste.invalid',{method:'POST',headers:{'x-token':'token'},body:JSON.stringify({action:'sincronizar',completa:true,pagina,parcial,inicio})}));res=await r.json();assert.equal(r.status,200,JSON.stringify(res));pagina=res.continua;parcial=res.contagens;inicio=res.inicio;}while(pagina);
const vivo=[...registros].filter(([,r])=>!r.apagadoEm&&!r._apagado);
const totais={};for(const [k,r] of vivo){const col=k.split('|')[0];totais[col]=(totais[col]||0)+1;}
const resumo={em:new Date().toISOString(),modo:'simulação local, nenhuma gravação remota',colecoes:totais,contagens:res.contagens,pendencias:metas.get('omie_sync').pendencias.length};
fs.writeFileSync('seed/simulacao-migracao-resumo.json',JSON.stringify(resumo,null,2),{mode:384});
fs.writeFileSync('seed/simulacao-migracao-dados.json',JSON.stringify([...registros.values()]),{mode:384});
console.log(JSON.stringify(resumo,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
