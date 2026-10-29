/* Regressões do destino vazio com dados fictícios; sem rede ou gravação real. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const raiz = path.resolve(__dirname, '..');

function registros({omie = false, candidato = false} = {}) {
  const anterior = {id:'contrato-anterior-ficticio',codigo:'VD-FICTICIA-ANTERIOR',clienteId:'111',clienteNome:'Pessoa fictícia',
    situacao:'distratada',quadra:1,lote:2,parcelas:[]};
  const reg = {venda:[anterior,{id:'outro-cpf-ficticio',codigo:'VD-OUTRO-CPF',clienteId:'222',situacao:'ativa',quadra:2,lote:3,parcelas:[]}],
    rec:[{id:'recebimento-ficticio',vendaId:anterior.id,valor:100,data:'2026-09-01',atualizadoEm:'2026-10-01T12:00:00.000Z'}],
    titulo:[],cliente:[{id:'111',nome:'Pessoa fictícia'}],cx:[]};
  if (omie) {
    reg.rec[0].omie = {titulo:'titulo-ficticio',cpf:'111'};
    reg.titulo.push({id:'CONTA_A_RECEBER-titulo-ficticio',titulo:'titulo-ficticio',grupo:'CONTA_A_RECEBER',origem:'omie',
      cpf:'111',status:'ABERTO',valor:100,venc:'2026-09-01',original:{resumo:{nValAberto:100},detalhes:{cNumTitulo:'Q01L02'}}});
  }
  if (candidato) reg.venda.push({id:'destino-compativel-ficticio',codigo:'VD-DESTINO-FICTICIO',clienteId:'111',clienteNome:'Pessoa fictícia',
    situacao:'ativa',quadra:3,lote:4,parcelas:[],atualizadoEm:'2026-10-01T12:00:00.000Z'});
  return reg;
}

async function abrir(reg) {
  const {parseHTML} = await import((process.env.BSQ_TEST_DEPS || '/tmp/bosques-test-deps')+'/node_modules/linkedom/esm/index.js');
  const {document} = parseHTML('<html><body><main id="app"></main></body></html>');
  const chamadas = {api:0,omie:0,pull:0},location = {hash:'#/conciliacao'};
  const ctx = vm.createContext({window:{innerWidth:1200},document,location,CustomEvent:document.defaultView.CustomEvent,
    console,Intl,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto});
  for (const f of ['ui.js','financeiro-core.js','conciliacao.js']) vm.runInContext(fs.readFileSync(path.join(raiz,f),'utf8'),ctx,{filename:f});
  ctx.S = {reg,perfil:'direcao'};
  ctx.api = async()=>{chamadas.api++;throw Error('O teste não autoriza gravação');};
  ctx.apiOmie = async()=>{chamadas.omie++;return {ok:true,sync:{pendencias:[]}};};
  ctx.puxar = async()=>{chamadas.pull++;};
  const C = ctx.window.BSQ_CONCILIACAO;
  C.renderizar(document.querySelector('#app'));
  await new Promise(setImmediate);
  document.querySelector('[data-cq-id="recebimento-recebimento-ficticio"]').click();
  const modal = document.querySelector('.fundo-modal');
  assert.ok(modal,'O recebimento deve abrir o modal de conferência');
  return {C,ctx,document,modal,location,chamadas};
}

for (const omie of [false,true]) test('sem destino compatível, recebimento '+(omie?'Omie':'manual')+' mostra seletor desabilitado e nenhuma ação de salvar',async()=>{
  const reg=registros({omie}),antes=JSON.stringify(reg),{modal}=await abrir(reg),destino=modal.querySelector('[data-campo="destino"]');
  assert.ok(destino,'O seletor deve permanecer visível para explicar a indisponibilidade');
  assert.equal(destino.hasAttribute('disabled'),true,'Sem contrato compatível, não apresentar seletor operável vazio');
  assert.equal(destino.value||'','');
  assert.equal(modal.querySelector('[data-cq-salvar]'),null);
  assert.equal(modal.querySelector('[data-cq-proximo]'),null);
  assert.equal(modal.querySelector('[data-campo="politica"]'),null,'Sem destino não se escolhe política financeira');
  assert.equal(JSON.stringify(reg),antes);
});

test('estado vazio explica o CPF sem destino e a situação do contrato anterior',async()=>{
  const {modal}=await abrir(registros());
  assert.match(modal.textContent,/nenhum contrato (?:ativo|disponível|compatível)[\s\S]*CPF/i);
  assert.match(modal.textContent,/contrato anterior[\s\S]*distratad[oa]|distratad[oa][\s\S]*contrato anterior/i);
  assert.ok(modal.textContent.includes('VD-FICTICIA-ANTERIOR'),'Identificar qual contrato foi distratado');
  assert.ok(modal.querySelector('[data-cq-contrato-anterior]'),'Oferecer acesso à ficha preservada');
});

test('abrir contrato anterior apenas navega à ficha, sem chamar APIs ou alterar registros',async()=>{
  const reg=registros(),antes=JSON.stringify(reg),{modal,location,chamadas,document}=await abrir(reg);
  const botao=modal.querySelector('[data-cq-contrato-anterior]');
  assert.ok(botao,'O estado sem destino deve oferecer a ficha anterior');
  const contagens={...chamadas};botao.click();await new Promise(setImmediate);
  assert.equal(location.hash,'#/venda/contrato-anterior-ficticio');
  assert.deepEqual(chamadas,contagens,'A navegação não consulta nem grava por API');
  assert.equal(document.querySelector('.fundo-modal'),null,'A ficha não deve ficar atrás do modal');
  assert.equal(JSON.stringify(reg),antes);
});

for (const omie of [false,true]) test('com contrato válido, recebimento '+(omie?'Omie':'manual')+' permite escolher sem selecionar automaticamente',async()=>{
  const reg=registros({omie,candidato:true}),antes=JSON.stringify(reg),{modal}=await abrir(reg),destino=modal.querySelector('[data-campo="destino"]');
  assert.equal(destino.hasAttribute('disabled'),false);
  assert.equal(destino.value||'','');
  assert.deepEqual([...destino.querySelectorAll('option')].map(o=>o.value).filter(Boolean),['destino-compativel-ficticio']);
  assert.ok(modal.querySelector('[data-cq-salvar]'));
  assert.ok(modal.querySelector('[data-cq-proximo]'));
  assert.equal(!!modal.querySelector('[data-campo="politica"]'),omie);
  assert.equal(JSON.stringify(reg),antes);
});

test('escolha de contrato com CPF diferente continua rejeitada antes de enviar',async()=>{
  for (const omie of [false,true]) {
    const reg=registros({omie,candidato:true}),antes=JSON.stringify(reg),{C,chamadas}=await abrir(reg);
    const item=C.montarFilas(reg,{}).recebimentos.find(i=>i.rec.id==='recebimento-ficticio');
    assert.throws(()=>C.prepararPayload(item,{destino:'outro-cpf-ficticio',politica:'pendente',motivo:'Comprovante fictício conferido'},reg,'operacao-ficticia'),/outro CPF|CPF\/CNPJ/i);
    assert.equal(chamadas.api,0);assert.equal(JSON.stringify(reg),antes);
  }
});
