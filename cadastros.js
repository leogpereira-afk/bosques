/* CADASTROS — clientes (agrupados por letra) e corretores (ranking de vendas
   com as comissões DENTRO — clicou no corretor, vê tudo dele).

   O id do cliente/corretor é o CPF (só dígitos) quando existe: mesma regra da
   importação, evita o mesmo comprador entrar duas vezes com grafias diferentes. */

/* ── Ficha (modal) ─────────────────────────────────────────────────────────── */
function fichaPessoaCorpo(p, ehCorretor) {
  return '<div class="colunas">' +
    campo('Nome', entrada('nome', p.nome || '')) +
    campo('CPF/CNPJ', entrada('cpf', p.cpf || '', { inputmode: 'numeric' })) +
  '</div><div class="colunas">' +
    campo('WhatsApp', entrada('whatsapp', p.whatsapp || '', { inputmode: 'tel' })) +
    campo('Celular', entrada('celular', p.celular || '', { inputmode: 'tel' })) +
  '</div>' +
  campo('E-mail', entrada('email', p.email || '', { tipo: 'email' })) +
  (ehCorretor
    ? '<div class="colunas">' +
        campo('Chave PIX', entrada('chavePix', p.chavePix || '')) +
        campo('Banco / conta', entrada('banco', p.banco || '')) +
      '</div>'
    : campo('Endereço', entrada('endereco', p.endereco || '')) +
      '<div class="colunas-3">' +
        campo('Bairro', entrada('bairro', p.bairro || '')) +
        campo('Cidade', entrada('cidade', p.cidade || 'Montes Claros')) +
        campo('UF', entrada('uf', p.uf || 'MG', { max: 2 })) +
        campo('CEP', entrada('cep', p.cep || '', { inputmode: 'numeric' })) +
      '</div>') +
  campo('Observações', areaTexto('obs', p.obs || ''));
}

function abrirFichaPessoa(col, id) {
  const ehCorretor = col === 'corretor';
  const p = id ? (achar(col, id) || {}) : {};
  const vendas = id ? lista('venda').filter((v) => (ehCorretor ? v.corretorId : v.clienteId) === id) : [];
  // Na ficha do CLIENTE, cada venda mostra o corretor que vendeu.
  const comp = !ehCorretor && id ? completudeCliente(p) : null;
  const blocoComp = comp
    ? '<div class="campo"><label>Cadastro ' + comp.pct + '% completo</label>' +
      (comp.faltam.length
        ? '<div class="nota">falta preencher: <b>' + comp.faltam.join(', ') + '</b></div>'
        : '<div class="nota" style="color:var(--verde)">✓ tudo preenchido</div>') + '</div>'
    : '';
  const extras = vendas.length
    ? '<div class="campo"><label>Vendas</label>' + vendas.map((v) =>
        '<div class="nota" style="padding:2px 0">• <a href="#/venda/' + esc(v.id) + '" onclick="fecharModal()">' +
        esc(v.codigo || '') + '</a> Q' + v.quadra + '-L' + v.lote +
        (ehCorretor ? ' · ' + esc(v.clienteNome || '') : (v.corretorNome ? ' · corretor: ' + esc(v.corretorNome) : ' · sem corretor')) +
        ' · ' + fmt.data(v.dataVenda || v.criadoEm) + ' ' + etiqueta(v.situacao || 'ativa') + '</div>').join('') + '</div>'
    : '';
  abrirModal({
    titulo: (id ? '' : 'Novo ') + (ehCorretor ? 'corretor' : 'cliente') + (p.nome ? ' — ' + p.nome : ''),
    corpo: (blocoComp || '') + fichaPessoaCorpo(p, ehCorretor) + extras,
    largo: true,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      ...(id && ehCorretor ? [{
        texto: p.ativo === false ? 'Reativar' : 'Desativar',
        aoClicar: (fundo) => {
          salvar(col, { id, ativo: p.ativo === false });
          fecharSilencioso(fundo);
          TELAS[ehCorretor ? 'corretores' : 'clientes']();
        },
      }] : []),
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        if (!v.nome || !v.nome.trim()) { toast('Diga o nome', 'ruim'); return; }
        const cpf = String(v.cpf || '').replace(/\D/g, '');
        salvar(col, {
          id: id || cpf || undefined,
          nome: v.nome.trim().slice(0, 90), cpf,
          whatsapp: String(v.whatsapp || '').slice(0, 30), celular: String(v.celular || '').slice(0, 30),
          email: String(v.email || '').slice(0, 90),
          ...(ehCorretor
            ? { chavePix: String(v.chavePix || '').slice(0, 90), banco: String(v.banco || '').slice(0, 90) }
            : { endereco: String(v.endereco || '').slice(0, 160), bairro: String(v.bairro || '').slice(0, 60),
                cidade: String(v.cidade || '').slice(0, 60), uf: String(v.uf || '').slice(0, 2).toUpperCase(),
                cep: String(v.cep || '').slice(0, 12) }),
          obs: String(v.obs || '').slice(0, 500),
        });
        fecharSilencioso(fundo);
        toast('Salvo');
        TELAS[ehCorretor ? 'corretores' : 'clientes']();
      } },
    ],
  });
}

/* ── Completude do cadastro do cliente ──────────────────────────────────────
   A % aparece NA LISTA (verde aos 100%) e a ficha diz o que falta — cobrar
   cadastro completo só funciona quando dá para VER quem está devendo o quê. */
const CAMPOS_CADASTRO = [
  ['nome', 'nome'], ['cpf', 'CPF'], ['_tel', 'telefone'], ['email', 'e-mail'],
  ['endereco', 'endereço'], ['bairro', 'bairro'], ['cidade', 'cidade'], ['uf', 'UF'], ['cep', 'CEP'],
];
function completudeCliente(c) {
  const faltam = [];
  for (const [campo2, rotulo] of CAMPOS_CADASTRO) {
    const tem = campo2 === '_tel' ? (c.whatsapp || c.celular) : c[campo2];
    if (!String(tem || '').trim()) faltam.push(rotulo);
  }
  const pct = Math.round((CAMPOS_CADASTRO.length - faltam.length) / CAMPOS_CADASTRO.length * 100);
  return { pct, faltam };
}
const seloPct = (pct) => {
  const cor = pct === 100 ? 'background:#e3f2e4;color:#1b5e20'
    : pct >= 60 ? 'background:#fff8e1;color:#b26a00' : 'background:#ffebee;color:#c62828';
  return '<span class="etiqueta" style="' + cor + ';min-width:44px;text-align:center">' +
    (pct === 100 ? '✓ 100%' : pct + '%') + '</span>';
};

/* ── Tela: clientes por letra ──────────────────────────────────────────────── */
TELAS.clientes = function () {
  const app = document.getElementById('app');
  const filtro = TELAS._fclientes || { q: '' };
  TELAS._fclientes = filtro;
  const todos = lista('cliente').sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  const vendas = lista('venda');

  const linhaCliente = (p) => {
    const suas = vendas.filter((v) => v.clienteId === p.id);
    const corretores2 = [...new Set(suas.map((v) => v.corretorNome).filter(Boolean))];
    const comp = completudeCliente(p);
    return '<div class="lin cli-lin" data-id="' + esc(p.id) + '">' +
      seloPct(comp.pct) +
      '<div class="cresce"><b>' + esc(p.nome || '?') + '</b>' +
      '<span class="sub">' + (p.cpf ? fmt.doc(p.cpf) + ' · ' : '') +
        ((p.whatsapp || p.celular) ? fmt.telefone(p.whatsapp || p.celular) + ' · ' : '') +
        suas.length + ' lote(s)' +
        (corretores2.length ? ' · corretor: ' + esc(corretores2.join(', ')) : '') + '</span></div>' +
      ((p.whatsapp || p.celular) ? '<a class="btn mini whats" target="_blank" rel="noopener" onclick="event.stopPropagation()" href="' +
        linkWhats(p.whatsapp || p.celular, 'Olá, ' + (p.nome || '').split(' ')[0] + '!') + '">WhatsApp</a>' : '') +
    '</div>';
  };

  let corpo;
  if (filtro.q) {
    const achados = todos.filter((p) => ((p.nome || '') + ' ' + (p.cpf || '')).toLowerCase().includes(filtro.q.toLowerCase()));
    corpo = achados.map(linhaCliente).join('') || vazio('🔍', 'Ninguém com essa busca');
  } else {
    // Uma gaveta por letra: 80 nomes numa lista só ninguém acha; A–Z todo
    // mundo acha. A gaveta aberta fica lembrada enquanto a tela vive.
    TELAS._letrasAbertas = TELAS._letrasAbertas || new Set();
    const porLetra = {};
    for (const p of todos) {
      const l = (p.nome || '?').trim().charAt(0).toUpperCase();
      const letra = /[A-ZÀ-Ü]/.test(l) ? l.normalize('NFD').replace(/[̀-ͯ]/g, '') : '#';
      (porLetra[letra] = porLetra[letra] || []).push(p);
    }
    corpo = Object.keys(porLetra).sort().map((letra) =>
      '<details class="cartao" style="padding:10px 16px" data-letra="' + letra + '"' +
        (TELAS._letrasAbertas.has(letra) ? ' open' : '') + '>' +
      '<summary style="cursor:pointer;font-weight:800;font-size:16px">' + letra +
        ' <span class="nota">· ' + porLetra[letra].length + ' cliente(s)</span></summary>' +
      '<div style="margin-top:10px">' + porLetra[letra].map(linhaCliente).join('') + '</div></details>').join('');
  }

  const completos = todos.filter((p) => completudeCliente(p).pct === 100).length;
  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Clientes</div><div class="num">' + todos.length + '</div></div>' +
      '<div class="painel"><div class="rot">Cadastro 100%</div><div class="num' + (completos === todos.length ? ' pos' : '') + '">' + completos + '</div>' +
        '<div class="sub">' + (todos.length ? Math.round(completos / todos.length * 100) : 0) + '% da carteira</div></div>' +
      '<div class="painel"><div class="rot">Incompletos</div><div class="num' + (todos.length - completos ? ' neg' : ' pos') + '">' + (todos.length - completos) + '</div>' +
        '<div class="sub">a % de cada um está na lista</div></div>' +
    '</div>' +
    '<div class="filtros">' +
      '<input type="search" id="cad-q" placeholder="nome ou CPF…" value="' + esc(filtro.q) + '">' +
      '<button class="btn primario" id="cad-novo">+ cliente</button>' +
    '</div>' + (corpo || vazio('👥', 'Ninguém por aqui ainda', 'Os compradores entram pela importação ou pela venda.'));

  document.getElementById('cad-q').oninput = (e) => { filtro.q = e.target.value; TELAS.clientes(); };
  document.getElementById('cad-novo').onclick = () => abrirFichaPessoa('cliente', null);
  app.querySelectorAll('.cli-lin').forEach((el) => {
    el.onclick = () => abrirFichaPessoa('cliente', el.dataset.id);
  });
  app.querySelectorAll('details[data-letra]').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) TELAS._letrasAbertas.add(d.dataset.letra);
      else TELAS._letrasAbertas.delete(d.dataset.letra);
    });
  });
};

/* ── Tela: corretores — ranking + tudo do corretor numa gaveta ─────────────── */
TELAS.corretores = function () {
  const app = document.getElementById('app');
  const corretores = lista('corretor');
  const vendas = lista('venda');
  const pagos = cxVivos().filter((c) => c.tipo === 'saida' && c.categoria === 'Comissão');

  // O ranking: quem vendeu mais (nº de vendas; empate decide pelo VGV).
  const ficha = corretores.map((cor) => {
    const suas = vendas.filter((v) => v.corretorId === cor.id && v.situacao !== 'distratada');
    const distratadas = vendas.filter((v) => v.corretorId === cor.id && v.situacao === 'distratada');
    const vgv = suas.reduce((s, v) => s + CARNE.resumo(v, cfgReajuste(), []).total, 0);
    const devido = suas.reduce((s, v) => s + (Number(v.comissao) || 0), 0);
    const pago = pagos.filter((p2) => p2.corretorId === cor.id).reduce((s, p2) => s + (Number(p2.valor) || 0), 0);
    return { cor, suas, distratadas, vgv, devido, pago, saldo: devido - pago };
  }).filter((x) => x.suas.length || x.pago > 0 || x.cor.ativo !== false)
    .sort((a, b) => (b.suas.length - a.suas.length) || (b.vgv - a.vgv));

  const totalVgv = ficha.reduce((s, x) => s + x.vgv, 0);
  const totalSaldo = ficha.reduce((s, x) => s + Math.max(0, x.saldo), 0);
  const semDono = pagos.filter((p2) => !p2.corretorId);
  TELAS._corAbertos = TELAS._corAbertos || new Set();

  const medalha = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + 'º';

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Corretores</div><div class="num">' + ficha.length + '</div></div>' +
      '<div class="painel"><div class="rot">VGV vendido por eles</div><div class="num pos">' + fmt.brl(totalVgv) + '</div></div>' +
      '<div class="painel"><div class="rot">Comissões a pagar</div><div class="num' + (totalSaldo > 0.01 ? ' neg' : '') + '">' + fmt.brl(totalSaldo) + '</div></div>' +
    '</div>' +
    '<div class="filtros"><button class="btn primario" id="cor-novo">+ corretor</button></div>' +
    ficha.map((x, i) =>
      '<details class="cartao" style="padding:12px 16px" data-cor="' + esc(x.cor.id) + '"' +
        (TELAS._corAbertos.has(x.cor.id) ? ' open' : '') + '>' +
      '<summary style="cursor:pointer;display:flex;align-items:center;gap:10px">' +
        '<span style="font-size:18px;min-width:34px">' + medalha(i) + '</span>' +
        '<span style="flex:1;min-width:0"><b>' + esc(x.cor.nome) + (x.cor.ativo === false ? ' (desativado)' : '') + '</b>' +
        '<span class="sub" style="display:block;font-size:12.5px;color:var(--tinta-fraca)">' +
          x.suas.length + ' venda(s) · VGV ' + fmt.brl(x.vgv) +
          (x.distratadas.length ? ' · ' + x.distratadas.length + ' distratada(s)' : '') + '</span></span>' +
        (x.saldo > 0.01 ? '<span class="etiqueta et-atrasada">a pagar ' + fmt.brl(x.saldo) + '</span>'
          : '<span class="etiqueta et-quitada">comissões em dia</span>') +
      '</summary>' +
      '<div style="margin-top:12px">' +
        '<div class="paineis" style="margin:0 0 10px">' +
          '<div class="painel"><div class="rot">Comissão combinada</div><div class="num">' + fmt.brl(x.devido) + '</div></div>' +
          '<div class="painel"><div class="rot">Já paga</div><div class="num pos">' + fmt.brl(x.pago) + '</div></div>' +
          '<div class="painel"><div class="rot">Saldo</div><div class="num' + (x.saldo > 0.01 ? ' neg' : '') + '">' + fmt.brl(x.saldo) + '</div></div>' +
        '</div>' +
        '<div class="acoes-linha" style="margin:0 0 10px">' +
          (x.saldo > 0.01 ? '<button class="btn primario bt-pagar" data-id="' + esc(x.cor.id) + '" data-nome="' + esc(x.cor.nome) + '" data-saldo="' + x.saldo.toFixed(2) + '">💸 Registrar pagamento</button>' : '') +
          '<button class="btn bt-ficha-cor" data-id="' + esc(x.cor.id) + '">✏️ Ficha' + (x.cor.chavePix ? ' · PIX ' + esc(x.cor.chavePix) : '') + '</button>' +
        '</div>' +
        '<h2 style="font-size:14px;margin:8px 0 6px">Clientes que compraram na mão dele</h2>' +
        (x.suas.map((v) => '<div class="lin venda-cor" data-id="' + esc(v.id) + '">' +
          '<div class="cresce"><b>' + esc(v.clienteNome || '?') + '</b>' +
          '<span class="sub">' + esc(v.codigo || '') + ' · Q' + v.quadra + '-L' + v.lote + ' · ' + fmt.data(v.dataVenda || v.criadoEm) +
            ' · comissão ' + fmt.brl(v.comissao) + '</span></div>' + etiqueta(v.situacao || 'ativa') + '</div>').join('') ||
          '<p class="nota">Nenhuma venda ainda.</p>') +
        (pagos.some((p2) => p2.corretorId === x.cor.id)
          ? '<h2 style="font-size:14px;margin:10px 0 4px">Pagamentos de comissão</h2>' +
            pagos.filter((p2) => p2.corretorId === x.cor.id).map((p2) =>
              '<div class="nota" style="padding:2px 0">✓ ' + fmt.brl(p2.valor) + ' em ' + fmt.data(p2.data) +
              (p2.obs ? ' · ' + esc(p2.obs) : '') + '</div>').join('')
          : '') +
      '</div></details>').join('') +
    (semDono.length
      ? '<div class="cartao" style="border-color:#f0ddb5"><h2>⚠ Comissões pagas sem corretor identificado <span class="nota">— clique para dizer de quem é</span></h2>' +
        semDono.map((p2) => '<div class="lin cx-associar" data-id="' + esc(p2.id) + '">' +
          '<div class="cresce"><b>' + esc(p2.descricao || 'Comissão') + '</b>' +
          '<span class="sub">' + fmt.data(p2.data) + (p2.obs ? ' · ' + esc(p2.obs) : '') + '</span></div>' +
          '<span class="dinheiro">' + fmt.brl(p2.valor) + '</span>' +
          '<span class="etiqueta et-hoje">associar →</span></div>').join('') + '</div>'
      : '');

  document.getElementById('cor-novo').onclick = () => abrirFichaPessoa('corretor', null);
  app.querySelectorAll('.bt-ficha-cor').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); abrirFichaPessoa('corretor', b.dataset.id); };
  });
  app.querySelectorAll('.venda-cor').forEach((el) => {
    el.onclick = () => { location.hash = '#/venda/' + el.dataset.id; };
  });
  app.querySelectorAll('details[data-cor]').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) TELAS._corAbertos.add(d.dataset.cor);
      else TELAS._corAbertos.delete(d.dataset.cor);
    });
  });
  app.querySelectorAll('.cx-associar').forEach((el) => {
    el.onclick = () => abrirAssociarComissao(el.dataset.id);
  });
  app.querySelectorAll('.bt-pagar').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      abrirPagarComissao(b.dataset.id, b.dataset.nome, Number(b.dataset.saldo));
    };
  });
};

/* ── Associar uma comissão órfã ao corretor certo ──────────────────────────
   O texto da planilha quase sempre TRAZ o nome ("COMISSAO RENATA") — o
   seletor já vem sugerido por ele; a pessoa só confirma. */
function abrirAssociarComissao(cxId) {
  const c = achar('cx', cxId);
  if (!c) return;
  const corretores = lista('corretor');
  const texto = ((c.descricao || '') + ' ' + (c.obs || '')).toUpperCase();
  const sugerido = corretores.find((cor) => {
    const primeiro = (cor.nome || '').trim().split(' ')[0].toUpperCase();
    return primeiro.length >= 4 && texto.includes(primeiro);
  });
  const corpo =
    '<div class="lin" style="cursor:default"><div class="cresce"><b>' + esc(c.descricao || 'Comissão') + '</b>' +
      '<span class="sub">' + fmt.data(c.data) + (c.obs ? ' · ' + esc(c.obs) : '') + '</span></div>' +
      '<span class="dinheiro">' + fmt.brl(c.valor) + '</span></div>' +
    campo('De quem é esta comissão?', seletor('corretorId', sugerido ? sugerido.id : '',
      corretores.map((cor) => ({ v: cor.id, t: cor.nome })), '— escolher —'),
      sugerido ? 'sugerido pelo nome no texto: ' + sugerido.nome : '');
  abrirModal({
    titulo: 'Associar comissão',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Associar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        if (!v.corretorId) { toast('Escolha o corretor', 'ruim'); return; }
        const cor = corretores.find((x) => x.id === v.corretorId);
        salvar('cx', {
          id: cxId, corretorId: v.corretorId,
          historico: historiar(c, 'Comissão associada a ' + (cor ? cor.nome : v.corretorId)),
        });
        fecharSilencioso(fundo);
        toast('Associada a ' + (cor ? cor.nome : ''));
        TELAS.corretores();
      } },
    ],
  });
}

function abrirPagarComissao(corId, nome, saldo) {
  const corpo =
    '<p class="nota">Saldo com ' + esc(nome) + ': <b>' + fmt.brl(saldo) + '</b></p>' +
    '<div class="colunas-3">' +
      campo('Valor pago (R$)', entrada('valor', saldo.toFixed(2), { inputmode: 'decimal' })) +
      campo('Em', entrada('data', hojeISO(), { tipo: 'date' })) +
      campo('Forma', seletor('forma', 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX'])) +
    '</div>' + campo('Observação', entrada('obs', '', { placeholder: 'quais vendas cobre…' }));
  abrirModal({
    titulo: 'Pagar comissão — ' + nome,
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Registrar', classe: 'primario', aoClicar: (fundo) => {
        const c = lerCampos(fundo);
        const valor = numeroBR(c.valor);
        if (!(valor > 0)) { toast('Diga o valor', 'ruim'); return; }
        salvar('cx', {
          tipo: 'saida', valor, data: c.data, forma: c.forma,
          categoria: 'Comissão', corretorId: corId,
          descricao: 'Comissão — ' + nome, obs: String(c.obs || '').slice(0, 300),
        });
        fecharSilencioso(fundo);
        toast('Comissão registrada');
        TELAS.corretores();
      } },
    ],
  });
}

// A rota antiga continua valendo (atalhos salvos), mas a casa é Corretores.
TELAS.comissoes = function () { location.hash = '#/corretores'; };
