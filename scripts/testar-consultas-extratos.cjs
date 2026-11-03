/* Reproduz cliques concorrentes usando as funções reais, sem rede. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('financeiro-painel.js','utf8');
const trecho=src.slice(src.indexOf('  async function consultarSaldos('),src.indexOf('  let auditoriaPagar='));
const pendente=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
(async()=>{
 const saldo=pendente(),historico=pendente(),revisao=pendente(),chamadas=[],avisos=[];
 const ctx=vm.createContext({saldosLendo:false,histLendo:false,saldosTentados:false,rendererAtual:null,dadosSaldos:null,histMensagem:'',
  document:{getElementById:()=>null,querySelector:()=>null},toast:m=>avisos.push(m),
  base:()=>({hoje:'2026-11-03',bancos:[]}),estado:()=>({conta:'1'}),
  F:{intervalo:()=>({valido:true,de:'2026-11-01',ate:'2026-11-03'}),sequencia:()=>[]},
  todasContas:()=>[{id:'1',nome:'Fictícia'}],hojeISO:()=> '2026-11-03',
  saldoBancosOmie:()=>{chamadas.push('saldos');return saldo.promise;},
  apiOmie:a=>{chamadas.push(a);return a==='historicoSaldos'?historico.promise:revisao.promise;},
  registrarExtrato:()=>{},puxar:async()=>{},financeiro:()=>{},console});
 vm.runInContext(trecho,ctx);
 const a=ctx.consultarSaldos(()=>{});
 await ctx.carregarHistorico(()=>{},true);await ctx.revisarMovimentos();
 assert.deepEqual(chamadas,['saldos']);assert.equal(avisos.length,2);
 saldo.resolve({contas:[],parcial:false});await a;
 const b=ctx.carregarHistorico(()=>{},true);
 await ctx.consultarSaldos(()=>{});await ctx.revisarMovimentos();
 assert.deepEqual(chamadas,['saldos','historicoSaldos']);assert.equal(avisos.length,4);
 historico.resolve({ok:true,extratos:[]});await b;
 const c=ctx.revisarMovimentos();
 await ctx.consultarSaldos(()=>{});await ctx.carregarHistorico(()=>{},true);
 assert.deepEqual(chamadas,['saldos','historicoSaldos','revisarMovimentos']);assert.equal(avisos.length,6);
 revisao.resolve({ok:true,corrigidos:0,quantidadeOrigem:0,extrato:{}});await c;
 await ctx.consultarSaldos(()=>{});
 assert.equal(chamadas.length,4,'Fim da consulta libera nova tentativa');
 console.log('PASSOU: saldos, extratos e revisão não concorrem; cliques informam espera e próxima consulta é liberada');
})().catch(e=>{console.error(e);process.exitCode=1;});
