/* ESPELHO — o mapa de vendas do loteamento: cada quadra, cada lote, quem está
   disponível, vendido ou reservado. Daqui saem o SIMULADOR e a PROPOSTA.

   Preço e parcela vêm do CADASTRO DO LOTE (4 preços por lote, herdados da
   planilha): parcela fixa / reajustada 6%, cada uma com e sem o desconto de
   20%. A venda escolhe o tipo; o valor pode ser ajustado na mão. */

const lotes = () => lista('lote').sort((a, b) => (a.quadra - b.quadra) || (a.lote - b.lote));
const nomeLote = (l) => l ? ('Q' + l.quadra + ' · L' + l.lote) : '—';
const recsDaVenda = (vid) => lista('rec').filter((r) => r.vendaId === vid);
const cfgReajuste = () => (S.cfg && S.cfg.reajuste) || { pct: 6, aCada: 12 };
const ehCorretorPerfil = () => S.perfil === 'corretor';

// Vendas em atraso por lote (para o "!" no espelho) — só direção/escritório.
function lotesComAtraso() {
  const marca = new Set();
  if (ehCorretorPerfil()) return marca;
  for (const v of lista('venda')) {
    if (v.situacao && v.situacao !== 'ativa' && v.situacao !== 'conferir') continue;
    const r = CARNE.resumo(v, cfgReajuste(), recsDaVenda(v.id));
    if (r.qtdAtraso > 0) marca.add(v.loteId);
  }
  return marca;
}

/* ── Tela: espelho ─────────────────────────────────────────────────────────── */
TELAS.espelho = function () {
  const app = document.getElementById('app');
  const ls = lotes();
  if (!ls.length) { app.innerHTML = vazio('🗺️', 'Nenhum lote cadastrado', 'Os lotes entram pela importação da planilha ou por Configurações.'); return; }

  const quadras = [...new Set(ls.map((l) => l.quadra))].sort((a, b) => a - b);
  const filtro = TELAS._fEspelho || { q: '', quadra: '', status: '' };
  TELAS._fEspelho = filtro;

  const disp = ls.filter((l) => l.status === 'Disponível').length;
  const vend = ls.filter((l) => l.status === 'Vendido').length;
  const atrasos = lotesComAtraso();

  const filtrados = ls.filter((l) =>
    (!filtro.quadra || String(l.quadra) === filtro.quadra) &&
    (!filtro.status || l.status === filtro.status) &&
    (!filtro.q || (l.lote + '').includes(filtro.q) || nomeLote(l).toLowerCase().includes(filtro.q.toLowerCase())));

  const blocos = quadras
    .filter((q) => filtrados.some((l) => l.quadra === q))
    .map((q) => {
      const doQ = filtrados.filter((l) => l.quadra === q);
      return '<div class="quadra-bloco"><h3>Quadra ' + q + ' <span class="nota">· ' +
        doQ.filter((l) => l.status === 'Disponível').length + ' disponíveis de ' + doQ.length + '</span></h3>' +
        '<div class="grade-lotes">' + doQ.map((l) => {
          const cls = l.status === 'Vendido' ? 'vendido' : l.status === 'Reservado' ? 'reservado' : 'disp';
          return '<div class="lote-q ' + cls + (atrasos.has(l.id) ? ' atraso' : '') + '" data-id="' + esc(l.id) + '">' +
            '<b>' + l.lote + '</b>' +
            '<span class="m2">' + fmt.numero(l.areaM2, 0) + ' m²</span>' +
            (l.status === 'Disponível'
              ? '<span class="preco">' + fmt.brl(l.preco).replace(',00', '') + '</span>'
              : '<span class="m2">' + esc(l.status) + '</span>') +
            '</div>';
        }).join('') + '</div></div>';
    }).join('');

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Lotes</div><div class="num">' + ls.length + '</div></div>' +
      '<div class="painel"><div class="rot">Disponíveis</div><div class="num pos">' + disp + '</div></div>' +
      '<div class="painel"><div class="rot">Vendidos</div><div class="num">' + vend + '</div>' +
        '<div class="sub">' + Math.round(vend / ls.length * 100) + '% do total</div></div>' +
      (ehCorretorPerfil() ? '' :
      '<div class="painel"><div class="rot">Com atraso</div><div class="num' + (atrasos.size ? ' neg' : '') + '">' + atrasos.size + '</div></div>') +
    '</div>' +
    '<div class="filtros">' +
      '<input type="search" id="esp-q" placeholder="nº do lote…" value="' + esc(filtro.q) + '">' +
      '<select id="esp-quadra"><option value="">Todas as quadras</option>' +
        quadras.map((q) => '<option value="' + q + '"' + (filtro.quadra === String(q) ? ' selected' : '') + '>Quadra ' + q + '</option>').join('') + '</select>' +
      '<select id="esp-status"><option value="">Todos</option>' +
        ['Disponível', 'Reservado', 'Vendido'].map((s) => '<option' + (filtro.status === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
    '</div>' +
    '<div class="legenda"><span><i style="background:#fff"></i>Disponível</span>' +
      '<span><i style="background:#f0f0ef"></i>Vendido</span>' +
      '<span><i style="background:#fff8ec"></i>Reservado</span>' +
      (ehCorretorPerfil() ? '' : '<span><i style="background:#c62828;border-color:#c62828"></i> ! = parcela em atraso</span>') + '</div>' +
    (blocos || vazio('🔍', 'Nada com esse filtro'));

  document.getElementById('esp-q').oninput = (e) => { filtro.q = e.target.value; TELAS.espelho(); };
  document.getElementById('esp-quadra').onchange = (e) => { filtro.quadra = e.target.value; TELAS.espelho(); };
  document.getElementById('esp-status').onchange = (e) => { filtro.status = e.target.value; TELAS.espelho(); };
  document.querySelectorAll('.lote-q').forEach((el) => {
    el.onclick = () => { location.hash = '#/lote/' + el.dataset.id; };
  });
};

/* ── Tela: ficha do lote (com simulador) ───────────────────────────────────── */
TELAS.lote = function (id) {
  const app = document.getElementById('app');
  const l = achar('lote', id);
  if (!l) { app.innerHTML = vazio('🗺️', 'Lote não encontrado', 'Ele pode ter sido removido.') + '<a href="#/espelho">← voltar ao espelho</a>'; return; }
  const venda = l.vendaId ? achar('venda', l.vendaId) : null;
  const reaj = cfgReajuste();

  const sim = TELAS._sim && TELAS._sim.loteId === id ? TELAS._sim : {
    loteId: id, tipo: 'Fixa', entrada: 4000, qtde: 150,
  };
  TELAS._sim = sim;
  const parcelaDoTipo = () => sim.tipo === 'Reajustada' ? (l.parcReajDesc || l.parcReaj) : (l.parcFixaDesc || l.parcFixa);
  if (sim.valorParcela == null) sim.valorParcela = parcelaDoTipo();

  const cabec =
    '<div class="cartao"><h2>' + nomeLote(l) + ' ' + etiqueta(l.status) +
      (venda ? ' <a class="btn mini" href="#/venda/' + esc(venda.id) + '">abrir a venda ' + esc(venda.codigo || '') + '</a>' : '') + '</h2>' +
      '<div class="paineis" style="margin:0">' +
        '<div class="painel"><div class="rot">Área</div><div class="num">' + fmt.numero(l.areaM2, 2) + '</div><div class="sub">m²</div></div>' +
        '<div class="painel"><div class="rot">Preço de tabela</div><div class="num pos">' + fmt.brl(l.preco) + '</div></div>' +
        '<div class="painel"><div class="rot">Parcela fixa</div><div class="num">' + fmt.brl(l.parcFixaDesc) + '</div><div class="sub">com desconto · ' + fmt.brl(l.parcFixa) + ' sem</div></div>' +
        '<div class="painel"><div class="rot">Parcela reajustada</div><div class="num">' + fmt.brl(l.parcReajDesc) + '</div><div class="sub">+' + reaj.pct + '% a cada ' + reaj.aCada + ' · ' + fmt.brl(l.parcReaj) + ' sem desc.</div></div>' +
      '</div></div>';

  let simulador = '';
  if (l.status === 'Disponível') {
    const total = (Number(sim.entrada) || 0) + (Number(sim.qtde) || 0) * (Number(sim.valorParcela) || 0);
    simulador =
      '<div class="cartao"><h2>Simulador <span class="nota">— monte o plano e mande a proposta</span></h2>' +
      '<div class="colunas-3">' +
        campo('Tipo de parcela', seletor('tipo', sim.tipo, [{ v: 'Fixa', t: 'Fixa (mesmo valor)' }, { v: 'Reajustada', t: 'Reajustada +' + reaj.pct + '%/' + reaj.aCada + 'p' }])) +
        campo('Entrada (R$)', entrada('entrada', sim.entrada, { inputmode: 'decimal' })) +
        campo('Nº de parcelas', entrada('qtde', sim.qtde, { inputmode: 'numeric' })) +
      '</div>' +
      '<div class="colunas">' +
        campo('Valor da parcela (R$)', entrada('valorParcela', sim.valorParcela, { inputmode: 'decimal' }), 'sugerido pela tabela do lote — pode ajustar') +
        '<div class="campo"><label>Total do plano</label><div style="font-size:21px;font-weight:800;padding:7px 0" id="sim-total">' + fmt.brl(total) + '</div></div>' +
      '</div>' +
      '<div class="acoes-linha">' +
        '<button class="btn primario" id="bt-proposta">📄 Enviar proposta</button>' +
        (ehCorretorPerfil() ? '' : '<button class="btn" id="bt-venda">✅ Registrar venda</button>') +
      '</div></div>';
  }

  app.innerHTML = '<a class="nota" href="#/espelho">← espelho</a>' + cabec + simulador;

  if (l.status !== 'Disponível') return;
  const raiz = app;
  raiz.querySelectorAll('[data-campo]').forEach((el) => {
    el.addEventListener('input', () => {
      const v = lerCampos(raiz);
      const tipoAntes = sim.tipo;
      Object.assign(sim, { tipo: v.tipo, entrada: numeroBR(v.entrada), qtde: Math.round(numeroBR(v.qtde)), valorParcela: numeroBR(v.valorParcela) });
      if (v.tipo !== tipoAntes) { sim.valorParcela = parcelaDoTipo(); TELAS.lote(id); return; }
      const total = sim.entrada + sim.qtde * sim.valorParcela;
      document.getElementById('sim-total').textContent = fmt.brl(total);
    });
  });
  const btP = document.getElementById('bt-proposta');
  if (btP) btP.onclick = () => abrirProposta(l, { ...sim });
  const btV = document.getElementById('bt-venda');
  if (btV) btV.onclick = () => abrirNovaVenda(l, { ...sim });
};

/* ── Proposta: gera o PDF, sobe, grava e entrega o link do WhatsApp ────────── */
function abrirProposta(l, sim) {
  const corretores = lista('corretor').filter((c) => c.ativo !== false);
  const souCorretor = ehCorretorPerfil();
  const corpo =
    '<div class="colunas">' +
      campo('Nome do interessado', entrada('nome', '', { placeholder: 'quem vai receber' })) +
      campo('WhatsApp dele', entrada('telefone', '', { inputmode: 'tel', placeholder: '(38) 9…' })) +
    '</div>' +
    (souCorretor ? '' :
      campo('Corretor', seletor('corretorId', '', corretores.map((c) => ({ v: c.id, t: c.nome })), 'sem corretor (a casa)'))) +
    '<p class="nota">Plano: entrada de <b>' + fmt.brl(sim.entrada) + '</b> + ' + sim.qtde + '× de <b>' +
      fmt.brl(sim.valorParcela) + '</b> (' + sim.tipo.toLowerCase() + ') — total ' + fmt.brl(sim.entrada + sim.qtde * sim.valorParcela) + '</p>';

  abrirModal({
    titulo: 'Proposta — ' + nomeLote(l),
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Gerar e pegar o link', classe: 'primario', aoClicar: async (fundo) => {
        const v = lerCampos(fundo);
        if (!v.nome || !v.nome.trim()) { toast('Diga o nome do interessado', 'ruim'); return; }
        const cor = souCorretor ? null : corretores.find((c) => c.id === v.corretorId);
        const prop = {
          loteId: l.id, quadra: l.quadra, lote: l.lote, areaM2: l.areaM2,
          valor: sim.entrada + sim.qtde * sim.valorParcela,
          entrada: sim.entrada, qtdeParcelas: sim.qtde, valorParcela: sim.valorParcela, tipoParcela: sim.tipo,
          cliente: { nome: v.nome.trim().slice(0, 80), telefone: String(v.telefone || '').slice(0, 30) },
          corretorNome: souCorretor ? (S.quem || '') : (cor ? cor.nome : ''),
          corretorId: souCorretor ? '' : (cor ? cor.id : ''),
          corretorTel: cor ? (cor.whatsapp || cor.celular || '') : '',
          validadeDias: (S.cfg && S.cfg.validadeProposta) || 7,
          enviadaEm: new Date().toISOString(),
          situacao: 'enviada',
        };
        const btn = fundo.querySelector('footer .primario');
        btn.disabled = true; btn.textContent = 'gerando…';
        try {
          // 1. grava a proposta (o servidor numera e sorteia o token do link)
          const salva = salvar('prop', prop);
          await subirFila();
          const doServidor = achar('prop', salva.id);
          if (!doServidor || !doServidor.tokenPublico) throw new Error('sem internet agora — a proposta precisa do servidor para gerar o link');
          // 2. PDF com o número já carimbado
          const pdfBlob = PDF.proposta(doServidor, l, S.cfg || {});
          const arq = await enviarArquivo(new File([pdfBlob], 'proposta.pdf', { type: 'application/pdf' }));
          // 3. liga o PDF à proposta
          salvar('prop', { id: salva.id, arquivoId: arq.id });
          await subirFila();
          fecharSilencioso(fundo);
          mostrarLinkProposta(achar('prop', salva.id));
        } catch (e) {
          toast(e.message || 'Não consegui gerar a proposta', 'ruim');
          btn.disabled = false; btn.textContent = 'Gerar e pegar o link';
        }
      } },
    ],
  });
}

function mostrarLinkProposta(p) {
  if (!p) return;
  const link = P_URL + '/' + p.id + '/' + p.tokenPublico;
  const msg = 'Olá' + (p.cliente && p.cliente.nome ? ', ' + p.cliente.nome.split(' ')[0] : '') +
    '! Segue sua proposta do lote Q' + p.quadra + '-L' + p.lote + ' no Portal dos Bosques: ' + link;
  abrirModal({
    titulo: 'Proposta ' + (p.codigo || '') + ' pronta',
    corpo:
      '<p>O link abre uma página com o resumo e o PDF. Cada abertura fica registrada aqui no sistema.</p>' +
      '<div class="campo" style="margin-top:10px"><label>Link</label><input type="text" readonly value="' + esc(link) + '" onclick="this.select()"></div>',
    acoes: [
      { texto: 'Copiar link', aoClicar: () => { navigator.clipboard && navigator.clipboard.writeText(link); toast('Link copiado'); } },
      { texto: 'Mandar no WhatsApp', classe: 'primario', aoClicar: () => {
        window.open(linkWhats((p.cliente && p.cliente.telefone) || '', msg), '_blank');
      } },
    ],
  });
}

/* ── Nova venda (direção/escritório) ───────────────────────────────────────── */
function abrirNovaVenda(l, sim) {
  const clientes = lista('cliente').sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  const corretores = lista('corretor').filter((c) => c.ativo !== false);
  const hoje = hojeISO();
  const corpo =
    campo('Cliente já cadastrado', seletor('clienteId', '', clientes.map((c) => ({ v: c.id, t: c.nome + (c.cpf ? ' · ' + fmt.doc(c.cpf) : '') })), '— cadastrar novo abaixo —')) +
    '<div class="colunas">' +
      campo('ou nome do cliente novo', entrada('nomeNovo', '')) +
      campo('CPF dele', entrada('cpfNovo', '', { inputmode: 'numeric' })) +
    '</div>' +
    '<div class="colunas">' +
      campo('WhatsApp', entrada('telNovo', '', { inputmode: 'tel' })) +
      campo('Data da venda', entrada('dataVenda', hoje, { tipo: 'date' })) +
    '</div><hr style="border:0;border-top:1px solid var(--borda);margin:6px 0 12px">' +
    '<div class="colunas">' +
      campo('Corretor', seletor('corretorId', '', corretores.map((c) => ({ v: c.id, t: c.nome })), 'sem corretor')) +
      campo('Comissão combinada (R$)', entrada('comissao', '', { inputmode: 'decimal' })) +
    '</div>' +
    '<div class="colunas-3">' +
      campo('Entrada (R$)', entrada('entrada', sim.entrada, { inputmode: 'decimal' })) +
      campo('Forma da entrada', seletor('formaEntrada', 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX', 'Dinheiro'])) +
      campo('Recebida em', entrada('dataEntrada', hoje, { tipo: 'date' }), 'deixe vazio se ainda não recebeu') +
    '</div>' +
    '<div class="colunas-3">' +
      campo('Nº de parcelas', entrada('qtde', sim.qtde, { inputmode: 'numeric' })) +
      campo('Valor da parcela', entrada('valorParcela', sim.valorParcela, { inputmode: 'decimal' })) +
      campo('Tipo', seletor('tipoParcela', sim.tipo, ['Fixa', 'Reajustada'])) +
    '</div>' +
    campo('Observações', areaTexto('obs', ''));

  abrirModal({
    titulo: 'Registrar venda — ' + nomeLote(l),
    corpo, largo: true,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Registrar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        let clienteId = v.clienteId, clienteNome = '';
        if (clienteId) {
          const c = achar('cliente', clienteId);
          clienteNome = c ? c.nome : '';
        } else {
          if (!v.nomeNovo || !v.nomeNovo.trim()) { toast('Escolha um cliente ou cadastre o novo', 'ruim'); return; }
          const cpf = String(v.cpfNovo || '').replace(/\D/g, '');
          const novo = salvar('cliente', {
            id: cpf || undefined, cpf, nome: v.nomeNovo.trim().slice(0, 90),
            whatsapp: String(v.telNovo || '').slice(0, 30),
          });
          clienteId = novo.id; clienteNome = novo.nome;
        }
        const cor = corretores.find((c) => c.id === v.corretorId);
        const entradaRS = numeroBR(v.entrada);
        const dataEntrada = v.dataEntrada || '';
        const venda = salvar('venda', {
          loteId: l.id, quadra: l.quadra, lote: l.lote,
          clienteId, clienteNome,
          corretorId: cor ? cor.id : '', corretorNome: cor ? cor.nome : '',
          comissao: numeroBR(v.comissao),
          dataVenda: v.dataVenda || hoje,
          entrada: entradaRS, formaEntrada: v.formaEntrada, dataEntrada,
          qtdeParcelas: Math.round(numeroBR(v.qtde)), valorParcela: numeroBR(v.valorParcela),
          tipoParcela: v.tipoParcela === 'Reajustada' ? 'Reajustada' : 'Fixa',
          situacao: 'ativa', obs: String(v.obs || '').slice(0, 800),
          historico: [{ id: Date.now().toString(36), em: new Date().toISOString(), por: S.quem || '—', o_que: 'Venda registrada' }],
        });
        // Entrada já recebida vira RECEBIMENTO na hora — o caixa nasce certo.
        if (entradaRS > 0 && dataEntrada) {
          salvar('rec', { vendaId: venda.id, tipo: 'entrada', valor: entradaRS, data: dataEntrada, forma: v.formaEntrada });
        }
        fecharSilencioso(fundo);
        toast('Venda registrada');
        location.hash = '#/venda/' + venda.id;
      } },
    ],
  });
}
