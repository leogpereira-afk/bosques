// Dados fictícios: regressões de leitura, sem rede nem escrita financeira.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
  const {parseHTML}=await import((process.env.BSQ_TEST_DEPS||'/tmp/bosques-test-deps')+'/node_modules/linkedom/esm/index.js');
  const {document}=parseHTML('<html><body><main id="app"></main></body></html>');
  const ctx=vm.createContext({window:{innerWidth:1200},document,CustomEvent:document.defaultView.CustomEvent,console,Intl,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto});
  for(const f of ['ui.js','financeiro-core.js','conciliacao.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
  const C=ctx.window.BSQ_CONCILIACAO;
  ctx.apiOmie=async()=>({ok:true,sync:{pendencias:[]}});
  let passaram=0,falhas=0;
  async function teste(nome,fn){try{await fn();passaram++;console.log('OK '+nome);}catch(e){falhas++;console.error('FALHOU '+nome+'\n'+e.stack);}finally{vm.runInContext('fecharModal()',ctx);}}
  const base=()=>({venda:[{id:'v1',codigo:'VD-FICTICIA',clienteId:'111',clienteNome:'Pessoa fictícia',quadra:1,lote:2,parcelas:[{tid:'t1',valor:100,venc:'2026-09-01'}]}],titulo:[{id:'CONTA_A_RECEBER-t1',titulo:'t1',cpf:'111',grupo:'CONTA_A_RECEBER',valor:100,venc:'2026-09-01'}],rec:[],cx:[]});
  async function abrir(reg){
    ctx.S={reg,perfil:'direcao'};
    vm.runInContext("TELAS._conciliacao={grupo:'parcelas',subtipo:'',q:'',conta:'',de:'',ate:'',pagina:0}",ctx);
    C.renderizar(document.querySelector('#app'));await new Promise(setImmediate);
    document.querySelector('[data-cq-id="titulo-t1"]').click();
    return document.querySelector('.cq-comparacao');
  }
  await teste('auditoria histórica conta apontamentos sem inventar quantidade de pendências abertas',()=>{
    const itens=[{titulo:'Texto concluído',situacao:'concluído'},{titulo:'Documento conferido',situacao:'conferido'},{titulo:'Conclusão parcial',situacao:'parcialmente concluída; documento pendente'},{titulo:'Registro sem estado'}];
    const a={quando:'2026-10-22T12:00:00Z',itens},antes=JSON.stringify(a),alvo=document.createElement('div');alvo.innerHTML=C.pendenciasAuditoria(a);
    assert.match(alvo.querySelector('summary').textContent,/Auditoria registrada.*4 apontamentos/);
    assert.doesNotMatch(alvo.querySelector('summary').textContent,/abert|concluíd|pendente/i);
    assert.match(alvo.textContent,/histórico.*não representa a fila atual/i);
    assert.match(alvo.textContent,/22\/10\/(?:2026|26)/);
    assert.equal(alvo.querySelector('details').hasAttribute('open'),false);
    assert.equal(alvo.querySelectorAll('article').length,4);
    for(const i of itens)assert.ok(alvo.textContent.includes(i.titulo));
    assert.ok(alvo.textContent.includes(itens[2].situacao));
    assert.doesNotMatch(alvo.querySelectorAll('article')[3].textContent,/aberta/i);
    assert.equal(JSON.stringify(a),antes);
  });
  await teste('duas parcelas do mesmo título no mesmo contrato são descritas como repetição local',()=>{
    const reg=base();reg.venda[0].parcelas.push({...reg.venda[0].parcelas[0]});
    const item=C.montarFilas(reg,{}).parcelas[0];
    assert.equal(item.subtipo,'vinculo');assert.match(item.motivo,/repetid.*mesmo contrato/i);assert.doesNotMatch(item.motivo,/mais de um contrato/i);
  });
  await teste('comparação preserva confirmação do contrato enquanto valores continuam pendentes',async()=>{
    const reg=base();Object.assign(reg.venda[0].parcelas[0],{conferir:true,vinculoConfirmado:true});const antes=JSON.stringify(reg),comparacao=await abrir(reg);
    assert.match(comparacao.textContent,/Contrato confirmado/);
    assert.match(comparacao.textContent,/Valor e vencimento.*Ainda a conferir/);
    assert.doesNotMatch(comparacao.textContent,/Ainda não confirmada/);
    assert.equal(JSON.stringify(reg),antes);
  });
  await teste('comparação não afirma vínculo confirmado quando há dois contratos possíveis',async()=>{
    const reg=base();reg.venda.push({...reg.venda[0],id:'v2',lote:3,parcelas:[{...reg.venda[0].parcelas[0]}]});
    const comparacao=await abrir(reg);assert.match(comparacao.textContent,/Vínculo ambíguo/);assert.doesNotMatch(comparacao.textContent,/Vínculo confirmado|Contrato confirmado/);
  });
  await teste('título marcado como ausente na origem não pode ser oferecido para associação',async()=>{
    const reg=base();reg.titulo[0].ausenteOrigemOmie={evidencia:'Leitura fictícia'};reg.venda[0].parcelas=[];
    assert.equal(C.montarFilas(reg,{}).parcelas.length,0);
  });
  await teste('fonte ausente mantém parcela pendente como sem origem e bloqueia confirmação',async()=>{
    const reg=base();reg.titulo[0].ausenteOrigemOmie={evidencia:'Leitura fictícia'};reg.venda[0].parcelas[0].conferir=true;
    const fila=C.montarFilas(reg,{}).parcelas;assert.equal(fila.length,1);assert.equal(fila[0].subtipo,'semorigem');
    ctx.S={reg,perfil:'direcao'};C.renderizar(document.querySelector('#app'));await new Promise(setImmediate);
    document.querySelector('[data-cq-id="semorigem-v1-t1"]').click();
    assert.equal(document.querySelector('[data-cq-salvar]'),null);assert.match(document.querySelector('.fundo-modal').textContent,/ausente/);
  });
  await teste('possível duplicidade não usa título cancelado pela bandeira canônica',()=>{
    const reg=base();reg.titulo=[{id:'CONTA_A_PAGAR-p1',titulo:'p1',grupo:'CONTA_A_PAGAR',valor:100,cancelado:true}];
    const saude={sync:{pendencias:[{tipo:'possivel_duplicidade',titulo:'p1',candidatos:[]}]}};
    assert.equal(C.montarFilas(reg,saude).duplicidades.length,0);
  });
  await teste('filtro de conta reúne registros locais e Omie da mesma conta sem duplicar opções',async()=>{
    const reg=base();reg.conta=[{id:'conta-local',omieId:7007,nome:'Conta fictícia'},{id:'dinheiro',nome:'Caixa local'}];
    reg.rec=[{id:'manual',valor:10,data:'2026-10-01',contaId:'conta-local'},{id:'importado',valor:20,data:'2026-10-01',financeiroOmie:{contaCodigo:7007,contaNome:'Conta fictícia'}},{id:'caixa',valor:30,data:'2026-10-01',contaId:'dinheiro'}];
    const antes=JSON.stringify(reg),fila=C.montarFilas(reg,{}).recebimentos;
    assert.equal(JSON.stringify(C.filtrar(fila,{conta:'7007'},reg).map(i=>i.rec.id).sort()),JSON.stringify(['importado','manual']));
    assert.equal(JSON.stringify(C.filtrar(fila,{conta:'dinheiro'},reg).map(i=>i.rec.id)),JSON.stringify(['caixa']));
    ctx.S={reg,perfil:'direcao'};vm.runInContext("TELAS._conciliacao={grupo:'recebimentos',subtipo:'',q:'',conta:'',de:'',ate:'',pagina:0}",ctx);
    C.renderizar(document.querySelector('#app'));await new Promise(setImmediate);
    const ids=[...document.querySelector('[data-cq-conta]').querySelectorAll('option')].map(o=>o.value).filter(Boolean).sort();
    assert.deepEqual(ids,['7007','dinheiro']);assert.equal(JSON.stringify(reg),antes);
  });
  await teste('identidade da conta preserva códigos Omie e contas sem integração',()=>{
    const F=vm.runInContext('FINANCEIRO',ctx);
    assert.equal(typeof F.identidadeConta,'function','O núcleo deve expor a identidade compartilhada das contas');
    const contas=Object.freeze([{id:'conta-local',omieId:7007},{id:'dinheiro'},{id:'sem-omie',omieId:''},{id:'7007',omieId:'8008'}].map(Object.freeze));
    for(const [id,esperado]of [['conta-local','7007'],[7007,'7007'],['7007','7007'],['dinheiro','dinheiro'],['sem-omie','sem-omie'],['externa','externa'],[null,''],[undefined,'']])assert.equal(F.identidadeConta(id,contas),esperado);
    assert.equal(F.identidadeConta('sem-cadastro'),'sem-cadastro');
  });
  await teste('pagamento histórico sem prova suficiente permanece na fila sem oferecer quitação por vínculo',async()=>{
    const reg=base();reg.venda[0].parcelas[0].venc='2025-12-01';
    Object.assign(reg.titulo[0],{venc:'2025-12-01',status:'RECEBIDO',original:{detalhes:{dDtPagamento:'10/12/2025'},resumo:{nValPago:100,nValLiquido:100,nValAberto:0,cLiquidado:'S',nDesconto:0,nJuros:0,nMulta:0}}});
    reg.rec=[{id:'manual-ficticio',vendaId:'v1',valor:100,data:'2025-12-10'}];
    const fila=C.montarFilas(reg,{},'2026-01-01'),item=fila.parcelas.find(i=>i.subtipo==='historico');assert.ok(item);
    assert.throws(()=>C.prepararPayload(item,{motivo:'Conferência fictícia',destino:'v1'},reg,'teste'),/histórico|comprovante/i);
    ctx.S={reg,perfil:'direcao',cfg:{omie:{corteEntradas:'2026-01-01'}}};
    vm.runInContext("TELAS._conciliacao={grupo:'parcelas',subtipo:'',q:'',conta:'',de:'',ate:'',pagina:0}",ctx);
    C.renderizar(document.querySelector('#app'));await new Promise(setImmediate);document.querySelector('[data-cq-id="'+item.chave+'"]').click();
    assert.equal(document.querySelector('[data-cq-salvar]'),null);assert.match(document.querySelector('.fundo-modal').textContent,/pagamento histórico/i);
  });
  await teste('origem explicitamente indisponível exige conferência mesmo sem marca na parcela',()=>{
    for(const flag of [{ausenteOrigemOmie:true},{cancelado:true},{apagadoEm:'2026-10-28'}]){
      const reg=base();Object.assign(reg.titulo[0],flag);
      assert.equal(C.montarFilas(reg,{}).parcelas.filter(i=>i.subtipo==='semorigem').length,1);
    }
  });
  await teste('corte ausente não oculta conferência de pagamento histórico',()=>{
    const reg=base();Object.assign(reg.titulo[0],{origem:'omie',status:'RECEBIDO',original:{detalhes:{dDtPagamento:'10/12/2025'},resumo:{nValPago:100,nValLiquido:100,nValAberto:0,cLiquidado:'S'}}});
    assert.equal(C.montarFilas(reg,{},'','2026-10-29').parcelas.filter(i=>i.subtipo==='historico').length,1);
  });
  console.log(passaram+' passaram; '+falhas+' falharam');if(falhas)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
