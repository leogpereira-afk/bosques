const {test}=require('node:test'),assert=require('node:assert/strict');
const V=require('../conciliacao-selecao.js');
function fixture(){return {venda:[1,2,3].map(n=>({id:'v'+n,codigo:'VD-TESTE-'+n,clienteId:'111',situacao:'ativa',loteId:'l'+n,quadra:1,lote:n,atualizadoEm:'v1',parcelas:n===1?[{tid:'t1',valor:100,venc:'2026-01-01'}]:[]})),rec:[{id:'r1',vendaId:'v1',clienteId:'111',omie:{titulo:'t1'},valor:100,atualizadoEm:'r1'},{id:'r2',clienteId:'111',omie:{titulo:'t2'},valor:50,atualizadoEm:'r2'},{id:'r3',clienteId:'222',valor:900}],titulo:[1,2].map(n=>({id:'CONTA_A_RECEBER-t'+n,titulo:'t'+n,cpf:'111',grupo:'CONTA_A_RECEBER',valor:100,status:'ABERTO',atualizadoEm:'t'+n}))};}
const campos=()=>({principal:'v1',vendas:['v1','v2','v3'],recebimentos:['r2'],titulos:[],politica:'pendente',motivo:'Contrato fictício conferido',confirmarPlanoPrincipal:true,plano:{entrada:0,entradaNoEspelho:false,qtdeParcelas:2,valorParcela:100,tipoParcela:'Fixa',inicioParcelas:'2026-01-01'}});
test('seleção de três lotes mantém identidade dos recebimentos e CAS do conjunto inteiro',()=>{const reg=fixture(),antes=JSON.stringify(reg),p=V.preparar(reg,campos(),'op1');assert.deepEqual(p.vendas,['v1','v2','v3']);assert.deepEqual(p.recebimentos,['r2']);assert.deepEqual(p.esperado.recebimentos,{r1:'r1',r2:'r2'});assert.deepEqual(p.esperado.titulos,{t1:'t1',t2:'t2'});assert.equal(p.plano.entrada,0);assert.equal(JSON.stringify(reg),antes);});
test('seleção não aceita pagamento de outro cliente nem parcela de venda não selecionada',()=>{const reg=fixture(),c=campos();c.recebimentos=['r3'];assert.throws(()=>V.preparar(reg,c,'op'),/CPF|cliente/i);c.recebimentos=[];c.vendas=['v2'];c.principal='v2';c.titulos=['t1'];assert.throws(()=>V.preparar(reg,c,'op'),/contrato|lote/i);});
test('plano do grupo requer conferência explícita e valores válidos',()=>{const reg=fixture(),c=campos();c.confirmarPlanoPrincipal=false;assert.throws(()=>V.preparar(reg,c,'op'),/confirme|confer/i);c.confirmarPlanoPrincipal=true;c.plano.entrada=-1;assert.throws(()=>V.preparar(reg,c,'op'),/entrada|valor/i);});
test('um único contrato pode receber pagamentos selecionados sem criar outro',()=>{const c=campos();c.vendas=['v1'];const p=V.preparar(fixture(),c,'op');assert.equal(p.principal,'v1');assert.equal(p.vendas.length,1);assert.deepEqual(p.recebimentos,['r2']);});
test('entrada sem venda envia classificação e motivo sem criar recebimento',()=>{const reg=fixture(),antes=JSON.stringify(reg);const p=V.prepararEntrada(reg,'r2','sem_venda','Boleto de teste','op');assert.deepEqual(p,{id:'r2',tipo:'sem_venda',motivo:'Boleto de teste',operacao:'op',esperado:{recebimento:'r2',titulo:'t2'}});assert.equal(JSON.stringify(reg),antes);assert.throws(()=>V.prepararEntrada(reg,'r1','sem_venda','teste','op'),/contrato/i);});
test('selecionar boleto inclui no CAS todos os recebimentos associados mesmo sem marcá-los individualmente',()=>{const reg=fixture(),c=campos();c.recebimentos=[];c.titulos=['t2'];const p=V.preparar(reg,c,'op');assert.deepEqual(p.esperado.recebimentos,{r1:'r1',r2:'r2'});});
test('contrato quitado não pode se tornar principal de obrigações novas',()=>{const reg=fixture();reg.venda[0].situacao='quitada';assert.throws(()=>V.preparar(reg,campos(),'op'),/principal.*ativo|contrato ativo/i);});
test('parcela manual acompanha o grupo sem exigir fonte Omie fictícia',()=>{const reg=fixture();reg.venda[0].parcelas.push({tid:'man-ficticia',origem:'manual',valor:25,venc:'2026-12-01'});const p=V.preparar(reg,campos(),'op');assert.deepEqual(Object.keys(p.esperado.titulos),['t1','t2']);});

async function tela(reg=fixture()){
  const fs=require('node:fs'),vm=require('node:vm'),{parseHTML}=await import((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/linkedom/esm/index.js');
  const {document}=parseHTML('<html><body><main id="app"></main></body></html>'),chamadas=[];
  const ctx=vm.createContext({document,window:{innerWidth:1200},location:{hash:'#/financeiro'},CustomEvent:document.defaultView.CustomEvent,console,Intl,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto});
  for(const f of ['ui.js','financeiro-core.js','conciliacao.js','conciliacao-selecao.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
  ctx.S={reg,perfil:'direcao'};ctx.api=async(a,p)=>{chamadas.push({a,p});return {ok:true};};ctx.apiOmie=async()=>({ok:true,sync:{pendencias:[]}});ctx.puxar=async()=>{};
  return {ctx,document,chamadas};
}
test('sem cliente selecionado não lista registros sem CPF; escolher cliente mostra apenas seus lotes e pagamentos',async()=>{
  const reg=fixture();
  reg.venda.push({id:'v-sem-cpf',codigo:'VD-SEM-CPF',clienteId:'',situacao:'ativa',loteId:'l-sem-cpf',quadra:9,lote:9});
  reg.rec.push({id:'r-sem-cpf',clienteId:'',valor:25});
  reg.titulo.push({id:'CONTA_A_RECEBER-t-sem-cpf',titulo:'t-sem-cpf',cpf:'',grupo:'CONTA_A_RECEBER',valor:25,status:'ABERTO'});
  const {ctx,chamadas}=await tela(reg),m=ctx.window.BSQ_VINCULACAO.abrir();
  const ids=kind=>[...m.querySelectorAll('[data-vg-lista="'+kind+'"]')].map(el=>el.value);
  for(const kind of ['vendas','recebimentos','titulos'])assert.deepEqual(ids(kind),[],kind+' deve aguardar a escolha do cliente');
  m.querySelector('[data-vg-cliente]').onchange({target:{value:'111'}});
  assert.deepEqual(ids('vendas'),['v1','v2','v3']);assert.deepEqual(ids('recebimentos'),['r1','r2']);assert.deepEqual(ids('titulos'),['t1','t2']);
  m.querySelector('[data-vg-cliente]').onchange({target:{value:''}});
  for(const kind of ['vendas','recebimentos','titulos'])assert.deepEqual(ids(kind),[]);
  assert.equal(chamadas.length,0);
});
test('selecionar lotes e revisar não grava; só confirmar envia uma operação ao servidor',async()=>{
  const {ctx,document,chamadas}=await tela(),regAntes=JSON.stringify(ctx.S.reg),m=ctx.window.BSQ_VINCULACAO.abrir({cpf:'111',recId:'r2'});
  for(const id of ['v1','v2','v3']){const el=m.querySelector('[data-vg-lista="vendas"][value="'+id+'"]');el.checked=true;el.onchange();}
  const motivo=m.querySelector('[data-vg="motivo"]');motivo.value='Contrato fictício revisado';motivo.oninput();
  const ok=m.querySelector('[data-vg="confirmarPlanoPrincipal"]');ok.checked=true;ok.oninput();
  m.querySelector('[data-vg-revisar]').click();assert.equal(chamadas.length,0);assert.equal(JSON.stringify(ctx.S.reg),regAntes);
  const revisao=[...document.querySelectorAll('.fundo-modal')].at(-1);assert.match(revisao.textContent,/3.*lotes|VD-TESTE-3/);assert.match(revisao.textContent,/2 recebimentos/);
  revisao.querySelector('footer button[data-i="1"]').click();await new Promise(setImmediate);
  assert.equal(chamadas.length,1);assert.equal(chamadas[0].a,'agruparContratos');assert.equal(chamadas[0].p.vendas.length,3);assert.equal(chamadas[0].p.recebimentos[0],'r2');
});
test('recebimento sem contrato oferece classificação e pede revisão antes de gravar',async()=>{
  const {ctx,document,chamadas}=await tela(),m=ctx.window.BSQ_VINCULACAO.entrada('r2');
  m.querySelector('[data-vg-motivo]').value='Boleto fictício de teste';m.querySelector('footer button[data-i="1"]').click();assert.equal(chamadas.length,0);
  const revisao=[...document.querySelectorAll('.fundo-modal')].at(-1);revisao.querySelector('footer button[data-i="1"]').click();await new Promise(setImmediate);
  assert.equal(chamadas.length,1);assert.equal(chamadas[0].a,'classificarEntrada');assert.equal(chamadas[0].p.tipo,'sem_venda');
});
