// DOM em memória e dados sintéticos. Foco nativo/tecnologia assistiva são conferidos na prévia.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const { parseHTML } = await import((process.env.BSQ_TEST_DEPS || '/tmp/bosques-test-deps') + '/node_modules/linkedom/esm/index.js');
  const { document, HTMLElement, Event } = parseHTML('<html><body><main id="app"><button id="origem">Abrir</button></main></body></html>').window;
  // Linkedom não implementa o foco do navegador: modela apenas o alvo de focus().
  let ativo = document.body;
  Object.defineProperty(document, 'activeElement', { get: () => ativo });
  HTMLElement.prototype.focus = function () { ativo = this; this.dispatchEvent(new Event('focusin', { bubbles: true })); };
  const c = vm.createContext({ document, window: { innerWidth: 390 }, console,
    CustomEvent: document.defaultView.CustomEvent, setTimeout: f => { f(); return 0; },
    clearTimeout() {}, URL, Blob });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8'), c);
  const run = s => vm.runInContext(s, c);
  const key = (tecla, shiftKey = false) => {
    const e = new Event('keydown', { bubbles: true, cancelable: true });
    Object.assign(e, { key: tecla, shiftKey }); document.dispatchEvent(e); return e;
  };
  const testes = [];
  const teste = (nome, f) => testes.push({ nome, f });

  teste('modal recebe nome acessível e foco inicial também no celular', () => {
    document.querySelector('#origem').focus();
    run("abrirModal({titulo:'Editar registro',corpo:campo('Nome do cliente',entrada('nome','Exemplo'),'Nome completo')+campo('Situação',seletor('situacao','ativa',['ativa','encerrada']))+campo('Observação',areaTexto('obs','')),acoes:[{texto:'Salvar'}]})");
    const dialog = document.querySelector('[role="dialog"]');
    const titulo = document.getElementById(dialog.getAttribute('aria-labelledby'));
    assert.equal(titulo?.textContent, 'Editar registro');
    assert.equal(dialog.contains(document.activeElement), true);
  });

  teste('rótulos e dicas ficam associados aos controles gerados', () => {
    for (const controle of document.querySelectorAll('[data-campo]')) {
      const label = document.querySelector('label[for="' + controle.id + '"]');
      assert.ok(controle.id); assert.ok(label?.textContent);
    }
    const nome = document.querySelector('[data-campo="nome"]');
    assert.equal(document.getElementById(nome.getAttribute('aria-describedby'))?.textContent, 'Nome completo');
  });

  teste('Tab e Shift+Tab ficam contidos no modal superior', () => {
    const dialog = document.querySelector('[role="dialog"]');
    dialog.querySelector('footer button').focus();
    assert.equal(key('Tab').defaultPrevented, true);
    assert.equal(document.activeElement.hasAttribute('data-fechar'), true);
    assert.equal(key('Tab', true).defaultPrevented, true);
    assert.equal(document.activeElement.textContent, 'Salvar');
  });

  teste('modal empilhado restaura foco e o fechamento final devolve o acionador', () => {
    document.querySelector('[data-campo="nome"]').focus();
    run("abrirModal({titulo:'Confirmar ação',corpo:'<p>Confirma?</p>',acoes:[{texto:'Continuar'}]})");
    key('Escape');
    assert.equal(document.activeElement.dataset.campo, 'nome');
    key('Escape'); assert.equal(document.activeElement.id, 'origem');
  });

  teste('modal sem controles segura foco e respeita semFechar', () => {
    run("abrirModal({titulo:'Aguarde',corpo:'<p>Carregando</p>',semFechar:true})");
    key('Tab'); assert.equal(document.activeElement.getAttribute('role'), 'dialog');
    key('Escape'); assert.ok(document.querySelector('[role="dialog"]'));
    run('fecharModal()'); assert.equal(document.activeElement.id, 'origem');
  });

  teste('fechar modal inferior não perde o acionador externo', () => {
    run("var base=abrirModal({titulo:'Base',corpo:'<button id=base-acao>Abrir</button>'});document.querySelector('#base-acao').focus();abrirModal({titulo:'Superior',corpo:'<button>OK</button>'});fecharEste(base)");
    key('Escape'); assert.equal(document.activeElement.id, 'origem');
  });

  teste('erro de gravação no botão mantém formulário e informa falha sem rejeição solta', async () => {
    run("var falhas=[];toast=(m)=>falhas.push(m);abrirModal({titulo:'Salvar registro',corpo:campo('Nome',entrada('teste','digitado')),acoes:[{texto:'Salvar',aoClicar:async()=>{throw new Error('Não foi possível guardar no aparelho')}}]})");
    document.querySelector('footer button').click(); await new Promise(setImmediate);
    assert.equal(document.querySelector('[data-campo="teste"]').value, 'digitado');
    assert.match(run('falhas[0]') || '', /guardar/); run('fecharModal()');
  });

  let falhas = 0;
  for (const { nome, f } of testes) {
    try { await f(); console.log('OK ' + nome); }
    catch (e) { falhas++; console.error('FALHOU ' + nome + '\n' + e.stack); }
  }
  console.log(`${testes.length - falhas}/${testes.length} verificações de acessibilidade passaram`);
  if (falhas) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
