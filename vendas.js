/* VENDAS — a carteira de contratos e o carnê de cada um.
 *
 * A pergunta desta tela é UMA: "quem está devendo, e quanto?". A lista abre
 * pelo atraso; a ficha abre pelo carnê. A baixa é um clique na parcela.
 *
 * O que ela NÃO faz, de propósito:
 *   • não grava "parcela paga" — grava um RECEBIMENTO (fato, com autor), e o
 *     carnê se recalcula (carne.js);
 *   • não edita valor de recebimento — estorna (lixeira, com log) e lança de
 *     novo: corrigir apagando é auditável, editar não;
 *   • não deixa distratar sem escrever o acerto: lote volta ao estoque PELO
 *     SERVIDOR, nunca pela tela.
 */

const vendasVivas = () => lista('venda').filter((v) => ['ativa', 'conferir'].includes(v.situacao || 'ativa'));

function resumoVenda(v) {
  return CARNE.resumo(v, cfgReajuste(), recsDaVenda(v.id));
}

/* ── Cobrança pelo WhatsApp ──────────────────────────────────────────────────
   A mensagem sai PRONTA: parcelas vencidas, valor total e os dados de
   pagamento das Configurações. Sem atraso, vira lembrete da próxima parcela.
   Cobrar deixa de ser redigir — vira um clique. */
function telDaVenda(v) {
  const c = v.clienteId ? achar('cliente', v.clienteId) : null;
  return c ? (c.whatsapp || c.celular || '') : '';
}
function msgCobranca(v, r) {
  const nome = (v.clienteNome || '').trim().split(' ')[0] || 'tudo bem';
  const loteTxt = 'Q' + v.quadra + '-L' + v.lote;
  const atrasadas = r.carne.filter((l) => l.situacao === 'atrasada');
  const conta = ((S.cfg && S.cfg.empresa && S.cfg.empresa.contaBancaria) || '').trim();
  let corpo;
  if (atrasadas.length) {
    const soma = atrasadas.reduce((s, l) => s + (l.valor - Math.min(l.pago, l.valor)), 0);
    const detalhe = atrasadas.slice(0, 3).map((l) => l.rotulo + ' (venceu ' + fmt.data(l.venc) + ')').join(', ') +
      (atrasadas.length > 3 ? ' e mais ' + (atrasadas.length - 3) : '');
    corpo = 'passando para lembrar que constam em aberto no seu lote ' + loteTxt + ': ' + detalhe +
      ', somando ' + fmt.brl(soma) + '.';
  } else if (r.proxima) {
    corpo = 'lembrando que a próxima parcela do seu lote ' + loteTxt + ' (' + r.proxima.rotulo +
      ', ' + fmt.brl(r.proxima.valor - r.proxima.pago) + ') vence em ' + fmt.data(r.proxima.venc) + '.';
  } else {
    corpo = 'sobre o seu lote ' + loteTxt + '.';
  }
  return 'Olá, ' + nome + '! Tudo bem? Aqui é do Portal dos Bosques 🌳 — ' + corpo +
    (conta ? '\n\nDados para pagamento:\n' + conta : '') +
    '\n\nSe já pagou, desconsidere e nos mande o comprovante. Qualquer coisa é só responder por aqui. Obrigado!';
}
function ultimaCobranca(v) {
  const cs = (v.cobrancas || []).filter(Boolean).map((c) => String(c.em || ''));
  return cs.length ? cs.sort().pop() : '';
}
function botaoCobranca(v, r, mini) {
  const tel = telDaVenda(v);
  // O boleto do Omie não depende de telefone: a linha digitável se copia
  // e paga em qualquer banco. Cliente sem WhatsApp ainda tem boleto.
  const btBoleto = (S.perfil !== 'corretor' && ['ativa', 'conferir'].includes(v.situacao || 'ativa'))
    ? '<button class="btn ' + (mini ? 'mini ' : '') + 'bt-boleto" data-venda="' + esc(v.id) + '" title="boletos em aberto no Omie, com linha digitável">📄' + (mini ? '' : ' Boleto') + '</button>'
    : '';
  if (!tel || !['ativa', 'conferir'].includes(v.situacao || 'ativa')) return btBoleto;
  const rot = r.qtdAtraso > 0 ? (mini ? '📱 cobrar' : '📱 Cobrar no WhatsApp') : (mini ? '📱 lembrar' : '📱 Lembrete da próxima parcela');
  const ult = ultimaCobranca(v);
  const cobradoHoje = ult && ult.slice(0, 10) === hojeISO();
  return (cobradoHoje ? '<span class="etiqueta et-quitada" title="cobrança registrada hoje">✓ cobrado hoje</span> ' : '') +
    '<a class="btn ' + (mini ? 'mini ' : '') + 'whats bt-cobrar" data-venda="' + esc(v.id) + '" target="_blank" rel="noopener" ' +
    'href="' + esc(linkWhats(tel, msgCobranca(v, r))) + '">' + rot + '</a>' +
    (btBoleto ? ' ' + btBoleto : '');
}
// Cada clique de cobrança FICA ESCRITO na venda (quem, quando, quanto estava
// em atraso) — é o que evita dois cobrando o mesmo cliente no mesmo dia.
function registrarCobranca(vendaId) {
  const v = achar('venda', vendaId);
  if (!v) return;
  const r = resumoVenda(v);
  salvar('venda', {
    id: vendaId,
    cobrancas: [{
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      em: new Date().toISOString(), por: S.quem || '—',
      valorAtraso: r.emAtraso, canal: 'whatsapp',
    }],
    historico: historiar(v, r.qtdAtraso > 0
      ? 'Cobrança enviada pelo WhatsApp (' + fmt.brl(r.emAtraso) + ' em atraso)'
      : 'Lembrete de parcela enviado pelo WhatsApp'),
  });
}
// Liga os botões de cobrança de uma tela: registra E deixa o link abrir.
function ligarBotoesCobranca(raiz) {
  raiz.querySelectorAll('.bt-cobrar').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      registrarCobranca(a.dataset.venda);
    });
  });
  raiz.querySelectorAll('.bt-boleto').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = achar('venda', b.dataset.venda);
      if (v) abrirBoletosVenda(v);
    });
  });
}

/* ── Tela: lista de vendas ─────────────────────────────────────────────────── */
TELAS.vendas = function () {
  const app = document.getElementById('app');
  const todas = lista('venda');
  if (!todas.length) { app.innerHTML = vazio('📋', 'Nenhuma venda ainda', 'Registre a primeira pelo espelho de lotes.'); return; }

  const filtro = TELAS._fVendas || { q: '', sit: '', so: '' };
  TELAS._fVendas = filtro;

  // O resumo de cada venda é calculado uma vez por render (150 parcelas × 100
  // vendas é barato: só aritmética).
  const linhas = todas.map((v) => ({ v, r: resumoVenda(v) }));
  const emAtraso = linhas.filter((x) => ['ativa', 'conferir'].includes(x.v.situacao || 'ativa') && x.r.qtdAtraso > 0);
  const totalAtraso = emAtraso.reduce((s, x) => s + x.r.emAtraso, 0);
  const mesStr = hojeISO().slice(0, 7);
  const recebidoMes = lista('rec').filter((r) => String(r.data || '').startsWith(mesStr))
    .reduce((s, r) => s + (Number(r.valor) || 0), 0);

  const filtradas = linhas.filter(({ v, r }) => {
    if (filtro.sit && (v.situacao || 'ativa') !== filtro.sit) return false;
    if (filtro.so === 'atraso' && !(r.qtdAtraso > 0 && ['ativa', 'conferir'].includes(v.situacao || 'ativa'))) return false;
    if (filtro.q) {
      const alvo = (v.clienteNome + ' Q' + v.quadra + ' L' + v.lote + ' ' + (v.codigo || '') + ' ' + (v.corretorNome || '')).toLowerCase();
      if (!alvo.includes(filtro.q.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => (b.r.emAtraso - a.r.emAtraso) || String(b.v.criadoEm || '').localeCompare(a.v.criadoEm || ''));

  // VGV = o valor geral de vendas (soma dos contratos que estão de pé).
  const naoDistratadas = linhas.filter(({ v }) => v.situacao !== 'distratada');
  const vgv = naoDistratadas.reduce((s, x) => s + x.r.total, 0);

  // Uma linha de venda — a mesma peça nos dois modos (dentro do mês e na busca).
  const linhaVenda = ({ v, r }) => {
    const pct = r.total > 0 ? Math.round(r.pago / r.total * 100) : 0;
    return '<div class="lin' + (v.situacao === 'distratada' ? ' riscada' : '') + '" data-id="' + esc(v.id) + '">' +
      '<div class="cresce"><b>Q' + v.quadra + '-L' + v.lote + ' · ' + esc(v.clienteNome || '?') + '</b>' +
      '<span class="sub">' + esc(v.codigo || '') + (v.corretorNome ? ' · ' + esc(v.corretorNome) : '') +
        ' · pagou ' + pct + '% (' + fmt.brl(r.pago) + ' de ' + fmt.brl(r.total) + ')</span></div>' +
      (r.qtdAtraso > 0 && ['ativa', 'conferir'].includes(v.situacao || 'ativa')
        ? botaoCobranca(v, r, true) + '<span class="etiqueta et-atrasada">' + r.qtdAtraso + ' atrasada' + (r.qtdAtraso > 1 ? 's' : '') + ' · ' + fmt.brl(r.emAtraso) + '</span>'
        : etiqueta(v.situacao || 'ativa')) +
      '</div>';
  };

  // A tela é organizada PELO mês a mês: clica no mês e as vendas dele abrem
  // ali dentro. Só a busca/filtro tira do agrupamento (mostra o resultado
  // plano — procurar um nome não pode exigir saber o mês).
  const porMesVenda = {};
  for (const x of linhas) {
    const m = mesDe(x.v.dataVenda || x.v.criadoEm);
    const chave = /^\d{4}-\d{2}$/.test(m) ? m : 'sem-data';
    const b = porMesVenda[chave] = porMesVenda[chave] || { n: 0, vgv: 0, itens: [] };
    b.itens.push(x);
    if (x.v.situacao !== 'distratada') { b.n++; b.vgv += x.r.total; }
  }
  const mesesVenda = Object.keys(porMesVenda).sort().reverse();   // o mais novo em cima
  const maiorVgvMes = Math.max(1, ...mesesVenda.map((m) => porMesVenda[m].vgv));
  TELAS._mesesVdAbertos = TELAS._mesesVdAbertos || new Set();
  const ordenaAtraso = (a, b) => (b.r.emAtraso - a.r.emAtraso) || String(b.v.criadoEm || '').localeCompare(a.v.criadoEm || '');
  const cartaoMensal =
    '<div class="cartao" style="padding:12px 16px"><h2>📈 Vendas mês a mês <span class="nota">— clique no mês para abrir o que vendeu nele</span></h2>' +
    mesesVenda.map((m) => {
      const b = porMesVenda[m];
      return '<details data-mesvd="' + m + '"' + (TELAS._mesesVdAbertos.has(m) ? ' open' : '') + ' style="border-bottom:1px solid var(--borda)">' +
        '<summary style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:9px 2px">' +
          '<b style="min-width:74px">' + (m === 'sem-data' ? 'sem data' : nomeMes(m)) + '</b>' +
          '<span class="nota" style="min-width:74px">' + b.n + ' venda(s)</span>' +
          '<span style="flex:1"><span style="display:block;background:var(--verde-palido);border-radius:6px;height:12px;overflow:hidden">' +
            '<span style="display:block;width:' + Math.round(b.vgv / maiorVgvMes * 100) + '%;height:100%;background:var(--verde)"></span></span></span>' +
          '<b style="white-space:nowrap">' + fmt.brl(b.vgv) + '</b>' +
        '</summary>' +
        '<div style="padding:8px 0 10px">' + b.itens.sort(ordenaAtraso).map(linhaVenda).join('') + '</div>' +
        '</details>';
    }).join('') +
    '<div style="display:flex;gap:10px;padding:10px 2px 2px;font-weight:800"><span style="min-width:74px">TOTAL</span>' +
      '<span style="min-width:74px">' + naoDistratadas.length + '</span><span style="flex:1"></span>' +
      '<span>' + fmt.brl(vgv) + '</span></div>' +
    '</div>';

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">VGV vendido</div><div class="num pos">' + fmt.brl(vgv) + '</div>' +
        '<div class="sub">' + naoDistratadas.length + ' contrato(s) de pé</div></div>' +
      '<div class="painel"><div class="rot">Contratos vivos</div><div class="num">' + vendasVivas().length + '</div></div>' +
      '<div class="painel clicavel" id="pn-atraso"><div class="rot">Em atraso</div><div class="num' + (emAtraso.length ? ' neg' : ' pos') + '">' + emAtraso.length + '</div>' +
        '<div class="sub">' + fmt.brl(totalAtraso) + ' vencidos</div></div>' +
      '<div class="painel"><div class="rot">Recebido no mês</div><div class="num pos">' + fmt.brl(recebidoMes) + '</div></div>' +
      '<div class="painel"><div class="rot">Quitadas</div><div class="num">' + todas.filter((v) => v.situacao === 'quitada').length + '</div></div>' +
    '</div>' +
    '<div class="filtros">' +
      '<input type="search" id="vd-q" placeholder="cliente, lote, código…" value="' + esc(filtro.q) + '">' +
      '<select id="vd-sit"><option value="">Todas</option>' +
        [['ativa', 'Ativas'], ['conferir', 'Conferir'], ['quitada', 'Quitadas'], ['distratada', 'Distratadas']]
          .map(([v2, t]) => '<option value="' + v2 + '"' + (filtro.sit === v2 ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
      '<button class="chip' + (filtro.so === 'atraso' ? ' on' : '') + '" id="vd-atraso">só atraso</button>' +
      '<button class="btn mini" id="vd-pdf" title="baixa o retrato do que está na tela — filtrou, sai só o filtrado">📄 PDF</button>' +
      '<button class="btn mini" id="vd-sim" title="e se eu vender mais X chácaras?">🧮 Simulação</button>' +
      (emAtraso.length ? '<button class="btn mini primario" id="vd-fila">📣 Cobrar em série (' + emAtraso.length + ')</button>' : '') +
    '</div>' +
    ((filtro.q || filtro.sit || filtro.so)
      ? (filtradas.map(linhaVenda).join('') || vazio('🔍', 'Nada com esse filtro'))
      : cartaoMensal);

  document.getElementById('vd-sim').onclick = () => { location.hash = '#/simulacao'; };
  document.getElementById('vd-pdf').onclick = () => {
    // O recorte sai ESCRITO no papel: um PDF filtrado sem dizer o filtro
    // viraria "o total" na reunião.
    const pedacos = [];
    if (filtro.so === 'atraso') pedacos.push('só em atraso');
    if (filtro.sit) pedacos.push(({ ativa: 'ativas', conferir: 'a conferir', quitada: 'quitadas', distratada: 'distratadas' })[filtro.sit] || filtro.sit);
    if (filtro.q) pedacos.push('busca "' + filtro.q + '"');
    PDF.vendasDash(filtradas, pedacos.join(' · ') || 'todas as vendas', S.cfg || {});
    toast('PDF gerado — ' + filtradas.length + ' venda(s)');
  };
  const bFila = document.getElementById('vd-fila');
  if (bFila) bFila.onclick = abrirFilaCobranca;
  ligarBotoesCobranca(app);
  app.querySelectorAll('details[data-mesvd]').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) TELAS._mesesVdAbertos.add(d.dataset.mesvd);
      else TELAS._mesesVdAbertos.delete(d.dataset.mesvd);
    });
  });
  document.getElementById('vd-q').oninput = (e) => { filtro.q = e.target.value; TELAS.vendas(); };
  document.getElementById('vd-sit').onchange = (e) => { filtro.sit = e.target.value; TELAS.vendas(); };
  document.getElementById('vd-atraso').onclick = () => { filtro.so = filtro.so === 'atraso' ? '' : 'atraso'; TELAS.vendas(); };
  const pn = document.getElementById('pn-atraso');
  if (pn) pn.onclick = () => { filtro.so = 'atraso'; TELAS.vendas(); };
  app.querySelectorAll('.lin[data-id]').forEach((el) => {
    el.onclick = () => { location.hash = '#/venda/' + el.dataset.id; };
  });
};

/* ── Fila de cobrança: os atrasados um a um, sem se perder ─────────────────── */
function abrirFilaCobranca() {
  const fila = lista('venda')
    .filter((v) => ['ativa', 'conferir'].includes(v.situacao || 'ativa'))
    .map((v) => ({ v, r: resumoVenda(v) }))
    .filter((x) => x.r.qtdAtraso > 0)
    .sort((a, b) => b.r.emAtraso - a.r.emAtraso);
  if (!fila.length) { toast('Ninguém em atraso 🎉'); return; }
  let i = 0;

  const pinta = (fundo) => {
    const { v, r } = fila[i];
    const tel = telDaVenda(v);
    const ult = ultimaCobranca(v);
    const cobradoHoje = ult && ult.slice(0, 10) === hojeISO();
    fundo.querySelector('header h2').textContent = '📣 Cobrança em série — ' + (i + 1) + ' de ' + fila.length;
    fundo.querySelector('.corpo').innerHTML =
      '<div class="lin" style="cursor:default"><div class="cresce">' +
      '<b>' + esc(v.clienteNome || '?') + ' · Q' + v.quadra + '-L' + v.lote + '</b>' +
      '<span class="sub">' + esc(v.codigo || '') + ' · ' + r.qtdAtraso + ' parcela(s) vencida(s)' +
        (ult ? ' · última cobrança ' + fmt.quando(ult) : ' · nunca cobrado') + '</span></div>' +
      '<span class="dinheiro" style="color:var(--ruim)">' + fmt.brl(r.emAtraso) + '</span></div>' +
      (cobradoHoje ? '<p class="nota" style="color:var(--atencao)">⚠ Já foi cobrado HOJE — talvez pular.</p>' : '') +
      (tel ? '<p class="nota" style="margin-top:8px">' + esc(msgCobranca(v, r)).replace(/\n/g, '<br>') + '</p>'
           : '<p class="nota" style="color:var(--ruim);margin-top:8px">⚠ Sem telefone no cadastro — só pulando (complete o cadastro do cliente).</p>');
  };

  const avanca = (fundo) => {
    i++;
    if (i >= fila.length) {
      fundo.querySelector('.corpo').innerHTML = '<p style="text-align:center;font-size:17px">🎉 <b>Fila concluída!</b><br>' +
        '<span class="nota">' + fila.length + ' contrato(s) percorrido(s).</span></p>';
      fundo.querySelector('header h2').textContent = '📣 Cobrança em série — fim';
      return;
    }
    pinta(fundo);
  };

  const fundo = abrirModal({
    titulo: '📣 Cobrança em série',
    corpo: '<div class="corpo-fila"></div>',
    largo: true,
    acoes: [
      { texto: 'Encerrar', aoClicar: () => fecharModal() },
      { texto: 'Pular →', aoClicar: (f2) => avanca(f2) },
      { texto: '📱 Cobrar e próximo', classe: 'primario', aoClicar: (f2) => {
        if (i >= fila.length) { fecharModal(); return; }
        const { v, r } = fila[i];
        const tel = telDaVenda(v);
        if (!tel) { toast('Sem telefone — pulando', 'ruim'); avanca(f2); return; }
        window.open(linkWhats(tel, msgCobranca(v, r)), '_blank');
        registrarCobranca(v.id);
        avanca(f2);
      } },
    ],
  });
  pinta(fundo);
}

/* ── Tela: ficha da venda (o carnê) ────────────────────────────────────────── */
TELAS.venda = function (id) {
  const app = document.getElementById('app');
  const v = achar('venda', id);
  if (!v) { app.innerHTML = vazio('📋', 'Venda não encontrada') + '<a href="#/vendas">← vendas</a>'; return; }
  const cliente = v.clienteId ? achar('cliente', v.clienteId) : null;
  const recs = recsDaVenda(id);
  const r = resumoVenda(v);
  const sit = v.situacao || 'ativa';
  const viva = ['ativa', 'conferir'].includes(sit);

  const zap = cliente && (cliente.whatsapp || cliente.celular);
  const cabec =
    '<div class="cartao"><h2>' + esc(v.codigo || 'Venda') + ' — Q' + v.quadra + '-L' + v.lote + ' ' + etiqueta(sit) + '</h2>' +
    '<div class="sub" style="color:var(--tinta-fraca);font-size:13.5px">' +
      '👤 ' + esc(v.clienteNome || '?') + (cliente && cliente.cpf ? ' · ' + fmt.doc(cliente.cpf) : '') +
      (zap ? ' · <a href="' + linkWhats(zap, 'Olá, ' + (v.clienteNome || '').split(' ')[0] + '! Sobre seu lote Q' + v.quadra + '-L' + v.lote + ' no Portal dos Bosques…') + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
      (v.corretorNome ? '<br>🤝 corretor: ' + esc(v.corretorNome) + (v.comissao ? ' (comissão ' + fmt.brl(v.comissao) + ')' : '') +
        (v.corretor2Nome ? ' + ' + esc(v.corretor2Nome) + (v.comissao2 ? ' (' + fmt.brl(v.comissao2) + ')' : '') : '') : '') +
      (ultimaCobranca(v) ? '<br>📣 última cobrança: ' + fmt.quando(ultimaCobranca(v)) +
        ' (' + esc(((v.cobrancas || []).slice().sort((a, b) => String(a.em).localeCompare(b.em)).pop() || {}).por || '—') + ')' : '') +
      '<br>🗓️ venda em ' + fmt.data(v.dataVenda || v.criadoEm) +
      ' · plano: ' + fmt.brl(v.entrada) + ' de entrada' +
      (v.entradaDetalhe ? ' (' + esc(v.entradaDetalhe) + ')' : '') + ' + ' + (v.qtdeParcelas || 0) + '× ' + fmt.brl(v.valorParcela) +
      ' (' + esc(v.tipoParcela || 'Fixa') + ')' +
      (v.obs ? '<br>📝 ' + esc(v.obs) : '') +
    '</div>' +
    (sit === 'distratada' && v.distrato ? '<p class="nota" style="margin-top:8px">⛔ Distratada em ' + fmt.data(v.distrato.em) +
      (v.distrato.motivo ? ' — ' + esc(v.distrato.motivo) : '') +
      (v.distrato.valorDevolvido ? ' · devolvido ' + fmt.brl(v.distrato.valorDevolvido) : '') + '</p>' : '') +
    '<div class="paineis" style="margin:12px 0 0">' +
      '<div class="painel"><div class="rot">Contrato</div><div class="num">' + fmt.brl(r.total) + '</div></div>' +
      '<div class="painel"><div class="rot">Pago</div><div class="num pos">' + fmt.brl(r.pago) + '</div>' +
        '<div class="sub">' + (r.total ? Math.round(r.pago / r.total * 100) : 0) + '%</div></div>' +
      '<div class="painel"><div class="rot">Saldo</div><div class="num">' + fmt.brl(r.saldo) + '</div></div>' +
      '<div class="painel"><div class="rot">Em atraso</div><div class="num' + (r.qtdAtraso ? ' neg' : ' pos') + '">' +
        (r.qtdAtraso ? fmt.brl(r.emAtraso) : 'R$ 0,00') + '</div><div class="sub">' + r.qtdAtraso + ' parcela(s)</div></div>' +
    '</div>' +
    '<div class="acoes-linha">' +
      (viva ? '<button class="btn primario" id="bt-baixa">💰 Dar baixa</button>' : '') +
      (viva ? botaoCobranca(v, r, false) : '') +
      (viva && r.quitada ? '<button class="btn" id="bt-quitar">✅ Marcar quitada</button>' : '') +
      (viva ? '<button class="btn perigo" id="bt-distrato">Distratar…</button>' : '') +
      (sit === 'distratada' && S.perfil === 'direcao' ? '<button class="btn" id="bt-reabrir">Reabrir venda</button>' : '') +
      (sit === 'conferir' ? '<button class="btn" id="bt-ok">Conferido — marcar ativa</button>' : '') +
      '<button class="btn" id="bt-anexo">📎 Anexar contrato/arquivo</button>' +
      '<button class="btn" id="bt-pdf-venda">📄 Baixar PDF desta venda</button>' +
    '</div></div>';

  const linhasCarne = r.carne.map((l) => {
    const falta = Math.max(0, Math.round((l.valor - l.pago) * 100) / 100);
    return '<tr class="' + l.situacao + '">' +
      '<td>' + esc(l.rotulo) + '</td>' +
      '<td>' + fmt.data(l.venc) + '</td>' +
      '<td class="num">' + fmt.brl(l.valor) + '</td>' +
      '<td class="num">' + (l.pago ? fmt.brl(l.pago) : '—') + '</td>' +
      '<td>' + etiqueta(l.situacao) + '</td>' +
      '<td class="num">' + (viva && falta > 0
        ? '<button class="btn mini bt-baixa-n" data-n="' + l.n + '" data-falta="' + falta + '">baixar</button>' : '') + '</td>' +
      '</tr>';
  }).join('');

  const carne =
    '<div class="cartao"><h2>Carnê <span class="nota">— derivado do plano + recebimentos; nada aqui é gravado à mão</span></h2>' +
    (r.sobra > 0.004 ? '<p class="nota">⚠ Há ' + fmt.brl(r.sobra) + ' recebidos ALÉM do carnê — confira o plano ou os lançamentos.</p>' : '') +
    '<div class="rolagem"><table class="tabela"><thead><tr><th>Parcela</th><th>Vence</th><th class="num">Valor</th><th class="num">Pago</th><th>Situação</th><th></th></tr></thead>' +
    '<tbody>' + linhasCarne + '</tbody></table></div></div>';

  const linhasRecs = recs.sort((a, b) => String(b.data || '').localeCompare(a.data || '')).map((rc) =>
    '<div class="lin" style="cursor:default">' +
      '<div class="cresce"><b>' + fmt.brl(rc.valor) + ' <span class="nota">' + esc(rc.codigo || '') + '</span></b>' +
      '<span class="sub">' + fmt.data(rc.data) + ' · ' + esc(rc.forma || '') +
        (rc.tipo === 'entrada' ? ' · entrada' : rc.parcelaN ? ' · parcela ' + rc.parcelaN : '') +
        (rc.obs ? ' · ' + esc(rc.obs) : '') + ' · por ' + esc(rc.criadoPor || rc.atualizadoPor || '—') +
        (rc.origem === 'omie' ? ' · <b>🔗 omie</b>' : rc.origem === 'planilha' ? ' · 📄 planilha' : ' · ✍️ manual') + '</span></div>' +
      '<button class="btn mini bt-recibo" data-id="' + esc(rc.id) + '">recibo</button>' +
      (viva ? '<button class="btn mini perigo bt-estorno" data-id="' + esc(rc.id) + '">estornar</button>' : '') +
    '</div>').join('');

  const blocoRecs =
    '<div class="cartao"><h2>Recebimentos <span class="nota">— ' + recs.length + ' lançado(s)</span></h2>' +
    (linhasRecs || '<p class="nota">Nenhum dinheiro lançado ainda.</p>') + '</div>';

  const anexos = (v.anexos || []).filter((a) => a && !a.apagadoEm);
  const blocoAnexos =
    '<div class="cartao"><h2>Contrato e arquivos <span class="nota">— ' + anexos.length + ' arquivo(s)</span></h2>' +
    (anexos.map((a) =>
      '<div class="lin" style="cursor:default"><div class="cresce"><b>' + esc(a.nome || 'arquivo') + '</b>' +
      '<span class="sub">' + (a.rotulo ? esc(a.rotulo) + ' · ' : '') + fmt.data(a.em) + ' · por ' + esc(a.por || '—') + '</span></div>' +
      '<button class="btn mini bt-baixar-arq" data-id="' + esc(a.arquivoId) + '" data-nome="' + esc(a.nome || 'arquivo') + '">baixar</button></div>').join('') ||
      '<p class="nota">Suba aqui o contrato assinado — ele fica guardado com a venda.</p>') +
    '</div>';

  app.innerHTML = '<a class="nota" href="#/vendas">← vendas</a>' + cabec + carne + blocoRecs + blocoAnexos;

  /* ── ações ── */
  ligarBotoesCobranca(app);
  const bB = document.getElementById('bt-baixa');
  if (bB) bB.onclick = () => abrirBaixa(v, r);
  app.querySelectorAll('.bt-baixa-n').forEach((b) => {
    b.onclick = () => abrirBaixa(v, r, Number(b.dataset.n), Number(b.dataset.falta));
  });
  const bQ = document.getElementById('bt-quitar');
  if (bQ) bQ.onclick = async () => {
    if (await confirmar('Marcar a venda como QUITADA? O lote continua vendido; o carnê se encerra.')) {
      salvar('venda', { id, situacao: 'quitada', historico: historiar(achar('venda', id), 'Venda quitada') });
      TELAS.venda(id);
    }
  };
  const bOk = document.getElementById('bt-ok');
  if (bOk) bOk.onclick = async () => {
    if (await confirmar('Confirmar que esta venda está certa (era a marcada como "conferir" na importação)?')) {
      salvar('venda', { id, situacao: 'ativa', historico: historiar(achar('venda', id), 'Conferida após a importação') });
      TELAS.venda(id);
    }
  };
  const bD = document.getElementById('bt-distrato');
  if (bD) bD.onclick = () => abrirDistrato(v, r);
  const bR = document.getElementById('bt-reabrir');
  if (bR) bR.onclick = async () => {
    if (await confirmar('Reabrir esta venda? O lote volta a ficar Vendido — se alguém já comprou o lote de novo, o servidor vai recusar.')) {
      salvar('venda', { id, situacao: 'ativa', _reabrir: true, historico: historiar(achar('venda', id), 'Venda reaberta pela direção') });
      TELAS.venda(id);
    }
  };
  const bA = document.getElementById('bt-anexo');
  if (bA) bA.onclick = () => abrirAnexoVenda(v);
  const bPdf = document.getElementById('bt-pdf-venda');
  if (bPdf) bPdf.onclick = () => { PDF.venda(v, r, recs, S.cfg || {}); toast('PDF da ' + (v.codigo || 'venda') + ' gerado'); };
  app.querySelectorAll('.bt-estorno').forEach((b) => {
    b.onclick = async () => {
      const rc = achar('rec', b.dataset.id);
      if (!rc) return;
      if (await confirmar('Estornar o recebimento de ' + fmt.brl(rc.valor) + ' de ' + fmt.data(rc.data) +
        '? Ele sai do carnê e do caixa (fica na lixeira, com registro de quem estornou).', { perigo: true, ok: 'Estornar' })) {
        try {
          await api('apagar', { colecao: 'rec', id: rc.id });
          const arr = S.reg.rec || [];
          const i = arr.findIndex((x) => x.id === rc.id);
          if (i >= 0) arr[i] = { ...arr[i], apagadoEm: new Date().toISOString() };
          gravarCache();
          toast('Estornado');
          TELAS.venda(id);
        } catch (e) { toast(e.message || 'Não consegui estornar agora', 'ruim'); }
      }
    };
  });
  app.querySelectorAll('.bt-recibo').forEach((b) => {
    b.onclick = () => {
      const rc = achar('rec', b.dataset.id);
      if (rc) PDF.recibo(rc, v, S.cfg || {});
    };
  });
  app.querySelectorAll('.bt-baixar-arq').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = '…';
      try {
        const { blob, meta } = await baixarArquivo(b.dataset.id, (p) => { b.textContent = Math.round(p * 100) + '%'; });
        salvarNoAparelho(blob, b.dataset.nome || meta.nome);
      } catch (e) { toast(e.message || 'Falhou o download', 'ruim'); }
      b.disabled = false; b.textContent = 'baixar';
    };
  });
};

/* ── Baixa de parcela ──────────────────────────────────────────────────────── */
function abrirBaixa(v, r, parcelaN, faltaSugerida) {
  // Sem parcela cravada, sugere a mais antiga em aberto (FIFO — igual ao motor).
  const alvo = parcelaN != null ? r.carne.find((l) => l.n === parcelaN)
    : r.carne.find((l) => ['atrasada', 'hoje', 'parcial', 'aberta'].includes(l.situacao));
  const falta = faltaSugerida != null ? faltaSugerida
    : alvo ? Math.max(0, Math.round((alvo.valor - alvo.pago) * 100) / 100) : 0;
  const corpo =
    '<p class="nota">' + (alvo ? 'Sugerido: <b>' + esc(alvo.rotulo) + '</b> (' + fmt.data(alvo.venc) + '), faltam ' + fmt.brl(falta) + '.' : '') +
      ' Pagou mais ou menos que a parcela? Lança o valor REAL — o motor distribui certinho (parcial fica parcial, troco rola para a próxima).</p>' +
    '<div class="colunas-3">' +
      campo('Valor recebido (R$)', entrada('valor', falta || '', { inputmode: 'decimal' })) +
      campo('Em', entrada('data', hojeISO(), { tipo: 'date' })) +
      campo('Forma', seletor('forma', 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX', 'Dinheiro'])) +
    '</div>' +
    campo('Amarrar numa parcela específica?', seletor('parcelaN', parcelaN != null ? String(parcelaN) : '',
      r.carne.filter((l) => l.n > 0).map((l) => ({ v: String(l.n), t: l.rotulo + ' · ' + fmt.data(l.venc) })), 'não — aplicar na mais antiga em aberto')) +
    campo('Observação', entrada('obs', '', { placeholder: 'juros, acordo, quem trouxe…' }));

  abrirModal({
    titulo: 'Dar baixa — ' + (v.codigo || 'venda'),
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Lançar', classe: 'primario', aoClicar: (fundo) => {
        const c = lerCampos(fundo);
        const valor = numeroBR(c.valor);
        if (!(valor > 0)) { toast('Diga o valor recebido', 'ruim'); return; }
        if (!c.data) { toast('Diga a data', 'ruim'); return; }
        const nAlvo = c.parcelaN !== '' ? Number(c.parcelaN) : null;
        salvar('rec', {
          vendaId: v.id,
          tipo: nAlvo === 0 ? 'entrada' : 'parcela',
          parcelaN: nAlvo && nAlvo > 0 ? nAlvo : null,
          valor, data: c.data, forma: c.forma, obs: String(c.obs || '').slice(0, 300),
        });
        fecharSilencioso(fundo);
        toast('Baixa lançada — ' + fmt.brl(valor));
        TELAS.venda(v.id);
        // Confirmação na hora pelo WhatsApp: cliente que recebe "recebemos o
        // seu pagamento" paga o mês que vem com mais boa vontade.
        const tel = telDaVenda(v);
        if (tel) {
          const ref = nAlvo === 0 ? 'à entrada' : nAlvo > 0 ? 'à parcela ' + nAlvo + '/' + (v.qtdeParcelas || '') : 'ao pagamento';
          const msg = 'Olá, ' + ((v.clienteNome || '').split(' ')[0] || '') + '! Confirmamos o recebimento de ' +
            fmt.brl(valor) + ' em ' + fmt.data(c.data) + ', referente ' + ref +
            ' do seu lote Q' + v.quadra + '-L' + v.lote + '. Obrigado! 🌳 Portal dos Bosques';
          abrirModal({
            titulo: '✅ Baixa lançada',
            corpo: '<p>Quer mandar a confirmação de recebimento para <b>' + esc(v.clienteNome || '') + '</b> no WhatsApp?</p>' +
              '<p class="nota" style="margin-top:6px">' + esc(msg) + '</p>',
            acoes: [
              { texto: 'Agora não', aoClicar: () => fecharModal() },
              { texto: '📱 Mandar confirmação', classe: 'primario', aoClicar: (f2) => {
                window.open(linkWhats(tel, msg), '_blank');
                fecharSilencioso(f2);
              } },
            ],
          });
        }
      } },
    ],
  });
}

/* ── Distrato ──────────────────────────────────────────────────────────────── */
function abrirDistrato(v, r) {
  const corpo =
    '<p>O cliente pagou <b>' + fmt.brl(r.pago) + '</b> até aqui. O distrato encerra o carnê e o lote ' +
      '<b>Q' + v.quadra + '-L' + v.lote + '</b> volta ao estoque (quem decide o status do lote é o servidor).</p>' +
    '<div class="colunas">' +
      campo('Data do distrato', entrada('em', hojeISO(), { tipo: 'date' })) +
      campo('Valor a devolver (R$)', entrada('valorDevolvido', '', { inputmode: 'decimal' }), 'se for devolver — vira saída no caixa quando pago') +
    '</div>' +
    campo('Motivo / acerto combinado', areaTexto('motivo', '', 'ex.: desistiu; devolve 70% em 3x; retém taxa…')) +
    '<div class="campo"><label><input type="checkbox" data-campo="devolvidoAgora" style="width:auto;margin-right:6px">a devolução já foi paga hoje (lança a saída no caixa)</label></div>';

  abrirModal({
    titulo: 'Distratar ' + (v.codigo || 'venda'),
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Confirmar distrato', classe: 'perigo', aoClicar: async (fundo) => {
        const c = lerCampos(fundo);
        if (!(await confirmar('Distratar de verdade? O lote volta ao estoque e o carnê para de cobrar.', { perigo: true, ok: 'Distratar' }))) return;
        const valorDev = numeroBR(c.valorDevolvido);
        salvar('venda', {
          id: v.id, situacao: 'distratada',
          distrato: { em: c.em || hojeISO(), motivo: String(c.motivo || '').slice(0, 500), valorDevolvido: valorDev, por: S.quem || '—' },
          historico: historiar(achar('venda', v.id), 'Distrato: ' + (c.motivo || 'sem motivo escrito') +
            (valorDev ? ' · a devolver ' + fmt.brl(valorDev) : '')),
        });
        if (valorDev > 0 && c.devolvidoAgora) {
          salvar('cx', {
            tipo: 'saida', data: c.em || hojeISO(), valor: valorDev,
            descricao: 'Devolução do distrato ' + (v.codigo || '') + ' — ' + (v.clienteNome || ''),
            categoria: 'Distrato / devolução', vendaId: v.id,
          });
        }
        fecharSilencioso(fundo);
        toast('Venda distratada — o lote voltou ao estoque');
        TELAS.venda(v.id);
      } },
    ],
  });
}

/* ── Anexo (contrato assinado, comprovante) ────────────────────────────────── */
function abrirAnexoVenda(v) {
  const corpo =
    campo('O que é', seletor('rotulo', 'Contrato assinado',
      ['Contrato assinado', 'Distrato assinado', 'Comprovante', 'Documento do cliente', 'Outro'])) +
    '<div class="campo"><label>Arquivo (PDF ou foto)</label><input type="file" id="anexo-arq" accept=".pdf,image/*"></div>' +
    '<div class="nota" id="anexo-prog"></div>';
  abrirModal({
    titulo: 'Anexar à ' + (v.codigo || 'venda'),
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Enviar', classe: 'primario', aoClicar: async (fundo) => {
        const inp = fundo.querySelector('#anexo-arq');
        const f = inp.files && inp.files[0];
        if (!f) { toast('Escolha o arquivo', 'ruim'); return; }
        const c = lerCampos(fundo);
        const prog = fundo.querySelector('#anexo-prog');
        const btn = fundo.querySelector('footer .primario');
        btn.disabled = true;
        try {
          const meta = await enviarArquivo(f, (p) => { prog.textContent = 'enviando… ' + Math.round(p * 100) + '%'; });
          salvar('venda', {
            id: v.id,
            anexos: [{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), arquivoId: meta.id, nome: f.name, rotulo: c.rotulo, em: new Date().toISOString(), por: S.quem || '—' }],
            historico: historiar(achar('venda', v.id), 'Anexou "' + f.name + '" (' + c.rotulo + ')'),
          });
          fecharSilencioso(fundo);
          toast('Arquivo guardado na venda');
          TELAS.venda(v.id);
        } catch (e) {
          toast(e.message || 'Falhou o envio', 'ruim');
          btn.disabled = false;
        }
      } },
    ],
  });
}

/* ── Tela: propostas ───────────────────────────────────────────────────────── */
TELAS.propostas = function () {
  const app = document.getElementById('app');
  const props = lista('prop');
  if (!props.length) { app.innerHTML = vazio('📨', 'Nenhuma proposta enviada', 'Mande a primeira pelo simulador de um lote disponível.'); return; }

  // O corretor animado manda 10 numa tarde: dá para marcar várias e ARQUIVAR
  // de uma vez — elas saem da vista sem virar "recusada" (arquivar não julga).
  const f = TELAS._fProps || { sit: 'enviada' };
  TELAS._fProps = f;
  const sel = TELAS._propSel = TELAS._propSel || new Set();

  const abertas = props.filter((p) => (p.situacao || 'enviada') === 'enviada');
  const viradas = props.filter((p) => p.situacao === 'aceita');
  const doFiltro = props.filter((p) => f.sit === 'todas' ? true : (p.situacao || 'enviada') === f.sit);
  for (const id of [...sel]) if (!doFiltro.some((p) => p.id === id)) sel.delete(id);

  const chips = [['enviada', 'No ar (' + abertas.length + ')'], ['aceita', 'Viraram venda'],
    ['recusada', 'Não avançaram'], ['arquivada', 'Arquivadas'], ['todas', 'Todas']];

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Enviadas</div><div class="num">' + props.length + '</div></div>' +
      '<div class="painel"><div class="rot">No ar</div><div class="num">' + abertas.length + '</div></div>' +
      '<div class="painel"><div class="rot">Viraram venda</div><div class="num pos">' + viradas.length + '</div></div>' +
    '</div>' +
    '<div class="filtros"><div class="chips">' +
      chips.map(([v, t2]) => '<button class="chip' + (f.sit === v ? ' on' : '') + '" data-sit="' + v + '">' + t2 + '</button>').join('') +
    '</div>' +
    '<button class="btn mini" id="pr-arquivar"' + (sel.size ? '' : ' disabled') + '>🗂 Arquivar marcadas (' + sel.size + ')</button>' +
    '</div>' +
    (doFiltro.map((p) => {
      const eventos = (p.eventos || []);
      const interesse = eventos.some((e) => e.tipo === 'interesse');
      const podeMarcar = (p.situacao || 'enviada') !== 'arquivada';
      return '<div class="lin" data-id="' + esc(p.id) + '">' +
        (podeMarcar ? '<input type="checkbox" class="pr-check" data-id="' + esc(p.id) + '"' +
          (sel.has(p.id) ? ' checked' : '') + ' style="width:18px;height:18px;flex-shrink:0">' : '') +
        '<div class="cresce"><b>Q' + p.quadra + '-L' + p.lote + ' · ' + esc((p.cliente && p.cliente.nome) || '?') + '</b>' +
        '<span class="sub">' + esc(p.codigo || '') + ' · ' + fmt.brl(p.valor) + ' · por ' + esc(p.donoNome || '—') +
          ' · ' + fmt.quando(p.enviadaEm || p.criadoEm) +
          ' · 👁 ' + (p.views || 0) + (interesse ? ' · ✅ demonstrou interesse' : '') + '</span></div>' +
        etiqueta(p.situacao || 'enviada') + '</div>';
    }).join('') || vazio('🗂', 'Nada nesse filtro'));

  app.querySelectorAll('.chip[data-sit]').forEach((c) => {
    c.onclick = () => { f.sit = c.dataset.sit; sel.clear(); TELAS.propostas(); };
  });
  app.querySelectorAll('.pr-check').forEach((cb) => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id);
      const b = document.getElementById('pr-arquivar');
      b.disabled = !sel.size;
      b.textContent = '🗂 Arquivar marcadas (' + sel.size + ')';
    });
  });
  document.getElementById('pr-arquivar').onclick = async () => {
    if (!sel.size) return;
    if (await confirmar('Arquivar ' + sel.size + ' proposta(s)? Elas saem da vista mas ficam no CRM e no filtro "Arquivadas".')) {
      for (const id of sel) salvar('prop', { id, situacao: 'arquivada' });
      sel.clear();
      toast('Arquivadas');
      TELAS.propostas();
    }
  };
  app.querySelectorAll('.lin[data-id]').forEach((el) => {
    el.onclick = () => abrirFichaProposta(el.dataset.id);
  });
};

function abrirFichaProposta(id) {
  const p = achar('prop', id);
  if (!p) return;
  const lote = achar('lote', p.loteId);
  const link = P_URL + '/' + p.id + '/' + (p.tokenPublico || '');
  const eventos = (p.eventos || []).slice().reverse().slice(0, 12);
  const corpo =
    '<p><b>' + esc((p.cliente && p.cliente.nome) || '?') + '</b>' +
      ((p.cliente && p.cliente.telefone) ? ' · ' + fmt.telefone(p.cliente.telefone) : '') + '<br>' +
      '<span class="nota">' + fmt.brl(p.entrada) + ' + ' + p.qtdeParcelas + '× ' + fmt.brl(p.valorParcela) +
      ' (' + esc(p.tipoParcela || '') + ') · total ' + fmt.brl(p.valor) + ' · enviada por ' + esc(p.donoNome || '—') + '</span></p>' +
    (p.tokenPublico ? '<div class="campo"><label>Link do cliente · aberto ' + (p.views || 0) + 'x</label>' +
      '<input type="text" readonly value="' + esc(link) + '" onclick="this.select()"></div>' : '') +
    (eventos.length ? '<div class="campo"><label>Movimentos</label>' + eventos.map((e) =>
      '<div class="nota">' + fmt.dataHora(e.em) + ' — ' +
      ({ interesse: '✅ clicou "tenho interesse"', duvida: '💬 clicou "tirar dúvida"', abriu_pdf: '📄 abriu o PDF' }[e.tipo] || esc(e.tipo)) + '</div>').join('') + '</div>' : '');

  const rerender = () => { if (TELAS[rotaAtual().nome]) TELAS[rotaAtual().nome](rotaAtual().id); };
  const acoes = [{ texto: 'Fechar', aoClicar: () => fecharModal() }];
  if ((p.situacao || 'enviada') === 'arquivada') {
    acoes.push({ texto: 'Desarquivar', aoClicar: (fundo) => {
      salvar('prop', { id: p.id, situacao: 'enviada' });
      fecharSilencioso(fundo); rerender();
    } });
  }
  if ((p.situacao || 'enviada') === 'enviada') {
    acoes.push({ texto: '🗂 Arquivar', aoClicar: (fundo) => {
      salvar('prop', { id: p.id, situacao: 'arquivada' });
      fecharSilencioso(fundo); rerender();
    } });
    acoes.push({ texto: 'Não avançou', aoClicar: (fundo) => {
      salvar('prop', { id: p.id, situacao: 'recusada' });
      fecharSilencioso(fundo); rerender();
    } });
    if (!ehCorretorPerfil() && lote && lote.status === 'Disponível') {
      acoes.push({ texto: 'Virou venda!', classe: 'primario', aoClicar: (fundo) => {
        salvar('prop', { id: p.id, situacao: 'aceita' });
        fecharSilencioso(fundo);
        abrirNovaVenda(lote, {
          entrada: p.entrada, qtde: p.qtdeParcelas, valorParcela: p.valorParcela,
          tipo: p.tipoParcela === 'À vista' ? 'Avista' : (p.tipoParcela || 'Fixa'),
          corretorId: p.corretorId || '', comissao: p.comissao || '', formaPg: p.formaPg || 'PIX',
          cor2Id: p.corretor2Id || '', comissao2: p.comissao2 || '',
          nome: p.cliente && p.cliente.nome, telefone: p.cliente && p.cliente.telefone,
        });
      } });
    }
  }
  abrirModal({ titulo: 'Proposta ' + (p.codigo || ''), corpo, acoes });
}

/* ── Simulação de vendas: "e se eu vender mais X chácaras?" ──────────────────
   Cenário por cima do que já existe: quantas a mais, por quanto, em que ritmo
   — e o fluxo projetado soma os carnês ATUAIS com as vendas imaginadas.
   Projeção de contrato, não promessa: inadimplência não entra aqui. */
TELAS.simulacao = function () {
  const app = document.getElementById('app');
  const disp = lista('lote').filter((l) => l.status === 'Disponível');
  const mediaPreco = disp.length ? Math.round(disp.reduce((s, l) => s + (Number(l.preco) || 0), 0) / disp.length) : 45000;
  const mediaParc = disp.length ? Math.round(disp.reduce((s, l) => s + (Number(l.parcFixa) || 0), 0) / disp.length * 100) / 100 : 450;

  const f = TELAS._sim || {
    qtde: 5, preco: mediaPreco, entrada: (S.cfg && S.cfg.entradaPadrao) || 3000,
    parcelas: 150, parcela: mediaParc, porMes: 1, tipo: 'Fixa', horizonte: 12,
  };
  TELAS._sim = f;

  // ── o cenário ─────────────────────────────────────────────────────────────
  const n = Math.max(0, Math.round(numeroBR(f.qtde)));
  const preco = numeroBR(f.preco), entradaV = numeroBR(f.entrada);
  const nParc = Math.max(1, Math.round(numeroBR(f.parcelas)));
  const valParc = numeroBR(f.parcela);
  const porMes = Math.max(1, Math.round(numeroBR(f.porMes)));
  const H = Number(f.horizonte) || 12;
  const reaj = cfgReajuste();

  // fluxo novo: entrada no mês da venda, parcelas nos seguintes (com degraus se Reajustada)
  const novoPorMes = new Array(H).fill(0);
  let vgvNovo = 0;
  for (let i = 0; i < n; i++) {
    const mesVenda = Math.floor(i / porMes);          // 0 = mês que vem
    if (mesVenda < H) novoPorMes[mesVenda] += entradaV;
    vgvNovo += entradaV;
    for (let pnum = 1; pnum <= nParc; pnum++) {
      const degrau = f.tipo === 'Reajustada' ? Math.floor((pnum - 1) / (reaj.aCada || 12)) : 0;
      const v = Math.round(valParc * Math.pow(1 + (reaj.pct || 6) / 100, degrau) * 100) / 100;
      vgvNovo += v;
      const m = mesVenda + pnum;
      if (m < H) novoPorMes[m] += v;
    }
  }

  // fluxo atual: o que os carnês vivos já prometem, mês a mês
  const ar = aReceberPorMes();
  const mesesH = [];
  {
    const d = new Date(hojeISO() + 'T12:00:00');
    for (let i = 0; i < H; i++) {
      const dt = new Date(d.getFullYear(), d.getMonth() + 1 + i, 1);
      mesesH.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'));
    }
  }
  const atualH = mesesH.map((m) => ar.porMes[m] || 0);
  const somaAtual = atualH.reduce((s, v) => s + v, 0);
  const somaNovo = novoPorMes.reduce((s, v) => s + v, 0);
  const recebNovoH = somaNovo;

  const linhas = mesesH.map((m, i) =>
    '<tr><td>' + nomeMes(m) + '</td><td class="num">' + fmt.brl(atualH[i]) + '</td>' +
    '<td class="num" style="color:var(--verde)">' + (novoPorMes[i] ? '+' + fmt.brl(novoPorMes[i]) : '—') + '</td>' +
    '<td class="num" style="font-weight:700">' + fmt.brl(atualH[i] + novoPorMes[i]) + '</td></tr>').join('');

  const campoSim = (rot, nome, valor, dica) =>
    '<div class="campo"><label>' + esc(rot) + '</label>' +
    '<input id="sm-' + nome + '" value="' + esc(String(valor)) + '" inputmode="decimal">' +
    (dica ? '<div class="dica">' + dica + '</div>' : '') + '</div>';

  app.innerHTML =
    '<a class="nota" href="#/vendas">← vendas</a>' +
    '<div class="cartao"><h2>🧮 Simulação de vendas <span class="nota">— e se eu vender mais…</span></h2>' +
    '<div class="colunas-3">' +
      campoSim('Quantas chácaras a mais', 'qtde', f.qtde, disp.length + ' disponíveis no espelho') +
      campoSim('Preço médio (R$)', 'preco', f.preco, 'média dos disponíveis: ' + fmt.brl(mediaPreco)) +
      campoSim('Vendendo quantas por mês', 'porMes', f.porMes, '1 = uma por mês, a partir do mês que vem') +
    '</div><div class="colunas-3">' +
      campoSim('Entrada por venda (R$)', 'entrada', f.entrada) +
      campoSim('Parcelas', 'parcelas', f.parcelas) +
      campoSim('Valor da parcela (R$)', 'parcela', f.parcela, 'média de tabela dos disponíveis: ' + fmt.brl(mediaParc)) +
    '</div><div class="colunas-3">' +
      '<div class="campo"><label>Tipo de parcela</label><select id="sm-tipo">' +
        ['Fixa', 'Reajustada'].map((t) => '<option' + (f.tipo === t ? ' selected' : '') + '>' + t + '</option>').join('') +
      '</select><div class="dica">Reajustada: +' + (reaj.pct || 6) + '% a cada ' + (reaj.aCada || 12) + ' parcelas</div></div>' +
      '<div class="campo"><label>Horizonte</label><select id="sm-horizonte">' +
        [[12, '12 meses'], [24, '24 meses'], [36, '36 meses']].map(([v, t]) =>
          '<option value="' + v + '"' + (H === v ? ' selected' : '') + '>' + t + '</option>').join('') +
      '</select></div>' +
    '</div></div>' +

    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Faturamento das vendas novas (VGV)</div><div class="num pos">' + fmt.brl(vgvNovo) + '</div>' +
        '<div class="sub">' + n + ' venda(s) · contratos completos</div></div>' +
      '<div class="painel"><div class="rot">Entra no caixa em ' + H + ' meses</div><div class="num pos">+' + fmt.brl(recebNovoH) + '</div>' +
        '<div class="sub">só das vendas novas</div></div>' +
      '<div class="painel"><div class="rot">Recebimento total no horizonte</div><div class="num">' + fmt.brl(somaAtual + somaNovo) + '</div>' +
        '<div class="sub">carnês atuais ' + fmt.brl(somaAtual) + ' + novas</div></div>' +
    '</div>' +

    '<div class="cartao"><h2>Mês a mês</h2><div class="rolagem"><table class="tabela">' +
      '<thead><tr><th>Mês</th><th class="num">Carnês atuais</th><th class="num">Vendas novas</th><th class="num">Total</th></tr></thead>' +
      '<tbody>' + linhas +
      '<tr style="border-top:2px solid var(--borda);font-weight:800"><td>TOTAL</td><td class="num">' + fmt.brl(somaAtual) +
      '</td><td class="num" style="color:var(--verde)">+' + fmt.brl(somaNovo) + '</td><td class="num">' + fmt.brl(somaAtual + somaNovo) + '</td></tr>' +
      '</tbody></table></div>' +
    '<p class="nota">Projeção de contrato: mostra o que os carnês prometem se todo mundo pagar em dia — inadimplência e antecipação não entram. ' +
    'O vencido de hoje (' + fmt.brl(ar.vencido) + ') também fica de fora; ele aparece nos Relatórios.</p></div>';

  // Recalcula ao mudar qualquer campo — a tela É a resposta.
  for (const nome of ['qtde', 'preco', 'porMes', 'entrada', 'parcelas', 'parcela']) {
    document.getElementById('sm-' + nome).onchange = (e) => { f[nome] = e.target.value; TELAS.simulacao(); };
  }
  document.getElementById('sm-tipo').onchange = (e) => { f.tipo = e.target.value; TELAS.simulacao(); };
  document.getElementById('sm-horizonte').onchange = (e) => { f.horizonte = Number(e.target.value); TELAS.simulacao(); };
};
