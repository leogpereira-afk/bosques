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
      '</div>') +
  campo('Observações', areaTexto('obs', p.obs || ''));
}

function abrirFichaPessoa(col, id) {
  const ehCorretor = col === 'corretor';
  const p = id ? (achar(col, id) || {}) : {};
  const vendas = id ? lista('venda').filter((v) => (ehCorretor ? v.corretorId : v.clienteId) === id) : [];
  // Na ficha do CLIENTE, cada venda mostra o corretor que vendeu.
  const extras = vendas.length
    ? '<div class="campo"><label>Vendas</label>' + vendas.map((v) =>
        '<div class="nota" style="padding:2px 0">• <a href="#/venda/' + esc(v.id) + '" onclick="fecharModal()">' +
        esc(v.codigo || '') + '</a> Q' + v.quadra + '-L' + v.lote +
        (ehCorretor ? ' · ' + esc(v.clienteNome || '') : (v.corretorNome ? ' · corretor: ' + esc(v.corretorNome) : ' · sem corretor')) +
        ' · ' + fmt.data(v.dataVenda || v.criadoEm) + ' ' + etiqueta(v.situacao || 'ativa') + '</div>').join('') + '</div>'
    : '';
  abrirModal({
    titulo: (id ? '' : 'Novo ') + (ehCorretor ? 'corretor' : 'cliente') + (p.nome ? ' — ' + p.nome : ''),
    corpo: fichaPessoaCorpo(p, ehCorretor) + extras,
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
    return '<div class="lin cli-lin" data-id="' + esc(p.id) + '">' +
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

  app.innerHTML =
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
      ? '<div class="cartao" style="border-color:#f0ddb5"><h2>⚠ Comissões pagas sem corretor identificado</h2>' +
        semDono.map((p2) => '<div class="nota" style="padding:2px 0">• ' + fmt.brl(p2.valor) + ' em ' + fmt.data(p2.data) +
          ' · ' + esc(p2.descricao || '') + ' — abra o lançamento no Caixa para dizer de quem é</div>').join('') + '</div>'
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
  app.querySelectorAll('.bt-pagar').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      abrirPagarComissao(b.dataset.id, b.dataset.nome, Number(b.dataset.saldo));
    };
  });
};

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
