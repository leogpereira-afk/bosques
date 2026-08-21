/* CAIXA — o Totalizador da planilha, vivo. Entradas (recebimentos das vendas
 * + receitas avulsas), saídas (despesas + comissões + devoluções), resultado
 * mês a mês.
 *
 * A lição da planilha (paga lá, não aqui): o MESMO dinheiro morava em três
 * abas — a entrada da venda em "Vendas" E em "Outras Receitas", a comissão em
 * "Vendas" E em "Despesas". Aqui cada real tem UM lançamento: recebimento de
 * venda vive em 'rec'; todo o resto vive em 'cx'. Não existe coluna de
 * anotação — anotação é obs.
 */

const mesDe = (iso) => String(iso || '').slice(0, 7);
const nomeMes = (m) => {
  const [a, mm] = String(m).split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return (nomes[Number(mm) - 1] || mm) + '/' + a;
};
const cxVivos = () => lista('cx').filter((c) => !c.anotacao);

// Todos os movimentos de um mês, já com sinal e origem.
function movimentosDoMes(mes) {
  const movs = [];
  for (const r of lista('rec')) {
    if (mesDe(r.data) !== mes) continue;
    const v = achar('venda', r.vendaId);
    movs.push({
      id: r.id, col: 'rec', data: r.data, valor: Number(r.valor) || 0, entrada: true,
      descricao: (v ? 'Q' + v.quadra + '-L' + v.lote + ' · ' + (v.clienteNome || '') : 'Venda') +
        (r.tipo === 'entrada' ? ' (entrada)' : r.parcelaN ? ' (parc. ' + r.parcelaN + ')' : ''),
      categoria: 'Recebimento de venda', forma: r.forma || '', vendaId: r.vendaId, codigo: r.codigo || '',
    });
  }
  for (const c of cxVivos()) {
    if (mesDe(c.data) !== mes) continue;
    movs.push({
      id: c.id, col: 'cx', data: c.data, valor: Number(c.valor) || 0, entrada: c.tipo === 'entrada',
      descricao: c.descricao || '—', categoria: c.categoria || (c.tipo === 'entrada' ? 'Outros' : 'Despesa'),
      forma: c.forma || '', vendaId: c.vendaId || '', corretorId: c.corretorId || '',
    });
  }
  return movs.sort((a, b) => String(b.data).localeCompare(a.data));
}

function totaisDoMes(mes) {
  let entradas = 0, saidas = 0;
  for (const m of movimentosDoMes(mes)) {
    if (m.entrada) entradas += m.valor; else saidas += m.valor;
  }
  return { entradas, saidas, resultado: entradas - saidas };
}

// Meses com movimento (para os chips e a tabela anual).
function mesesComMovimento() {
  const set = new Set();
  for (const r of lista('rec')) if (r.data) set.add(mesDe(r.data));
  for (const c of cxVivos()) if (c.data) set.add(mesDe(c.data));
  set.add(mesDe(hojeISO()));
  return [...set].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
}

/* ── Tela: caixa ───────────────────────────────────────────────────────────── */
TELAS.caixa = function () {
  const app = document.getElementById('app');
  const meses = mesesComMovimento();
  const mes = TELAS._mesCaixa || mesDe(hojeISO());
  TELAS._mesCaixa = mes;
  const t = totaisDoMes(mes);
  const movs = movimentosDoMes(mes);

  // Projeção do mês: o que os carnês vivos deveriam trazer.
  let projecao = 0;
  for (const v of vendasVivas()) {
    for (const l of CARNE.gerarParcelas(v, cfgReajuste())) {
      if (mesDe(l.venc) === mes) projecao += l.valor;
    }
  }

  const ano = mes.slice(0, 4);
  const tabelaAno = meses.filter((m) => m.startsWith(ano)).map((m) => {
    const tm = totaisDoMes(m);
    return '<tr' + (m === mes ? ' style="font-weight:700"' : '') + '>' +
      '<td><a href="#" class="mes-link" data-m="' + m + '">' + nomeMes(m) + '</a></td>' +
      '<td class="num">' + fmt.brl(tm.entradas) + '</td>' +
      '<td class="num">' + fmt.brl(tm.saidas) + '</td>' +
      '<td class="num" style="color:' + (tm.resultado >= 0 ? 'var(--verde)' : 'var(--ruim)') + '">' + fmt.brl(tm.resultado) + '</td></tr>';
  }).join('');
  const tAno = meses.filter((m) => m.startsWith(ano)).reduce((s, m) => {
    const tm = totaisDoMes(m);
    return { e: s.e + tm.entradas, s2: s.s2 + tm.saidas };
  }, { e: 0, s2: 0 });

  // Lançamento sem data não aparece em mês nenhum — melhor gritar do que sumir
  // (a planilha tinha 2 despesas assim, e o Totalizador dela as perdia calado).
  const semData = cxVivos().filter((c) => !c.data);
  const avisoSemData = semData.length
    ? '<div class="cartao" style="border-color:#f0ddb5"><h2>⚠ ' + semData.length + ' lançamento(s) sem data <span class="nota">— fora de todos os meses até você datar</span></h2>' +
      semData.map((c) => '<div class="lin" style="cursor:default"><div class="cresce"><b>' + esc(c.descricao || '—') + '</b>' +
        '<span class="sub">' + (c.tipo === 'entrada' ? 'entrada' : 'saída') + ' · ' + esc(c.categoria || '') + '</span></div>' +
        '<span class="dinheiro">' + fmt.brl(c.valor) + '</span>' +
        '<button class="btn mini cx-datar" data-id="' + esc(c.id) + '">datar</button></div>').join('') + '</div>'
    : '';

  app.innerHTML =
    '<div class="filtros"><div class="chips">' +
      meses.map((m) => '<button class="chip' + (m === mes ? ' on' : '') + '" data-m="' + m + '">' + nomeMes(m) + '</button>').join('') +
    '</div></div>' + avisoSemData +
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Entradas · ' + nomeMes(mes) + '</div><div class="num pos">' + fmt.brl(t.entradas) + '</div>' +
        '<div class="sub">carnês previam ' + fmt.brl(projecao) + '</div></div>' +
      '<div class="painel"><div class="rot">Saídas</div><div class="num neg">' + fmt.brl(t.saidas) + '</div></div>' +
      '<div class="painel"><div class="rot">Resultado</div><div class="num ' + (t.resultado >= 0 ? 'pos' : 'neg') + '">' + fmt.brl(t.resultado) + '</div></div>' +
    '</div>' +
    '<div class="acoes-linha" style="margin:0 0 14px">' +
      '<button class="btn primario" id="cx-desp">− Nova despesa</button>' +
      '<button class="btn" id="cx-rece">+ Outra receita</button>' +
    '</div>' +
    '<div class="cartao"><h2>' + ano + ' mês a mês</h2><div class="rolagem"><table class="tabela">' +
      '<thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado</th></tr></thead>' +
      '<tbody>' + tabelaAno + '<tr style="border-top:2px solid var(--borda);font-weight:800"><td>TOTAL</td>' +
      '<td class="num">' + fmt.brl(tAno.e) + '</td><td class="num">' + fmt.brl(tAno.s2) + '</td>' +
      '<td class="num">' + fmt.brl(tAno.e - tAno.s2) + '</td></tr></tbody></table></div></div>' +
    '<div class="cartao"><h2>Lançamentos de ' + nomeMes(mes) + ' <span class="nota">— ' + movs.length + '</span></h2>' +
      (movs.map((m) => '<div class="lin" ' + (m.vendaId ? 'data-venda="' + esc(m.vendaId) + '"' : 'style="cursor:default"') + '>' +
        '<div class="cresce"><b>' + esc(m.descricao) + '</b>' +
        '<span class="sub">' + fmt.data(m.data) + ' · ' + esc(m.categoria) + (m.forma ? ' · ' + esc(m.forma) : '') + '</span></div>' +
        '<span class="dinheiro" style="color:' + (m.entrada ? 'var(--verde)' : 'var(--ruim)') + '">' +
          (m.entrada ? '+' : '−') + fmt.brl(m.valor) + '</span>' +
        (m.col === 'cx' ? '<button class="btn mini cx-apagar" data-id="' + esc(m.id) + '">🗑</button>' : '') +
        '</div>').join('') || '<p class="nota">Nenhum lançamento neste mês.</p>') +
    '</div>';

  app.querySelectorAll('.chip[data-m], .mes-link').forEach((el) => {
    el.onclick = (e) => { e.preventDefault(); TELAS._mesCaixa = el.dataset.m; TELAS.caixa(); };
  });
  app.querySelectorAll('.cx-datar').forEach((b) => {
    b.onclick = async () => {
      const c = achar('cx', b.dataset.id);
      if (!c) return;
      const d = await perguntarData('Quando foi "' + (c.descricao || '') + '" (' + fmt.brl(c.valor) + ')?');
      if (d) { salvar('cx', { id: c.id, data: d }); TELAS.caixa(); }
    };
  });
  document.getElementById('cx-desp').onclick = () => abrirLancamento('saida');
  document.getElementById('cx-rece').onclick = () => abrirLancamento('entrada');
  app.querySelectorAll('.lin[data-venda]').forEach((el) => {
    el.onclick = () => { location.hash = '#/venda/' + el.dataset.venda; };
  });
  app.querySelectorAll('.cx-apagar').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const c = achar('cx', b.dataset.id);
      if (!c) return;
      if (await confirmar('Apagar o lançamento "' + (c.descricao || '') + '" de ' + fmt.brl(c.valor) + '? (vai para a lixeira)', { perigo: true, ok: 'Apagar' })) {
        try {
          await api('apagar', { colecao: 'cx', id: c.id });
          const arr = S.reg.cx || [];
          const i = arr.findIndex((x) => x.id === c.id);
          if (i >= 0) arr[i] = { ...arr[i], apagadoEm: new Date().toISOString() };
          gravarCache();
          TELAS.caixa();
        } catch (err) { toast(err.message || 'Não consegui apagar agora', 'ruim'); }
      }
    };
  });
};

function abrirLancamento(tipo) {
  const cats = tipo === 'saida'
    ? ((S.cfg && S.cfg.categoriasDespesa) || ['Outros'])
    : ((S.cfg && S.cfg.categoriasReceita) || ['Outros']);
  const corpo =
    campo('Descrição', entrada('descricao', '', { placeholder: tipo === 'saida' ? 'ex.: patrola, contabilidade…' : 'ex.: aluguel da antena…' })) +
    '<div class="colunas-3">' +
      campo('Valor (R$)', entrada('valor', '', { inputmode: 'decimal' })) +
      campo('Data', entrada('data', hojeISO(), { tipo: 'date' })) +
      campo('Forma', seletor('forma', 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX'])) +
    '</div>' +
    campo('Categoria', seletor('categoria', cats[0], cats)) +
    campo('Observação', entrada('obs', ''));
  abrirModal({
    titulo: tipo === 'saida' ? 'Nova despesa' : 'Outra receita',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Lançar', classe: 'primario', aoClicar: (fundo) => {
        const c = lerCampos(fundo);
        const valor = numeroBR(c.valor);
        if (!c.descricao || !c.descricao.trim()) { toast('Descreva o lançamento', 'ruim'); return; }
        if (!(valor > 0)) { toast('Diga o valor', 'ruim'); return; }
        salvar('cx', {
          tipo, valor, data: c.data, forma: c.forma, categoria: c.categoria,
          descricao: c.descricao.trim().slice(0, 200), obs: String(c.obs || '').slice(0, 300),
        });
        fecharSilencioso(fundo);
        toast('Lançado');
        TELAS.caixa();
      } },
    ],
  });
}

/* ── Tela: comissões ───────────────────────────────────────────────────────── */
/* A pergunta: "quanto devo a cada corretor?" — o controle que na planilha era
   uma coluna de anotações "PG VITOR 1000, falta…". Devido = o combinado nas
   vendas dele. Pago = as saídas de caixa categoria Comissão no nome dele. */
TELAS.comissoes = function () {
  const app = document.getElementById('app');
  const corretores = lista('corretor');
  const vendas = lista('venda');
  const pagos = cxVivos().filter((c) => c.tipo === 'saida' && c.categoria === 'Comissão');

  const porCorretor = corretores.map((cor) => {
    const suas = vendas.filter((v) => v.corretorId === cor.id && v.situacao !== 'distratada');
    const distratadas = vendas.filter((v) => v.corretorId === cor.id && v.situacao === 'distratada');
    const devido = suas.reduce((s, v) => s + (Number(v.comissao) || 0), 0);
    const pago = pagos.filter((p) => p.corretorId === cor.id).reduce((s, p) => s + (Number(p.valor) || 0), 0);
    return { cor, suas, distratadas, devido, pago, saldo: devido - pago };
  }).filter((x) => x.suas.length || x.pago > 0)
    .sort((a, b) => b.saldo - a.saldo);

  const totalDevido = porCorretor.reduce((s, x) => s + x.devido, 0);
  const totalPago = porCorretor.reduce((s, x) => s + x.pago, 0);

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Comissões combinadas</div><div class="num">' + fmt.brl(totalDevido) + '</div></div>' +
      '<div class="painel"><div class="rot">Já pagas</div><div class="num pos">' + fmt.brl(totalPago) + '</div></div>' +
      '<div class="painel"><div class="rot">A pagar</div><div class="num' + (totalDevido - totalPago > 0.01 ? ' neg' : '') + '">' + fmt.brl(totalDevido - totalPago) + '</div></div>' +
    '</div>' +
    (porCorretor.map((x) =>
      '<div class="cartao"><h2>' + esc(x.cor.nome) +
        ' <span class="nota">· ' + x.suas.length + ' venda(s)' +
        (x.distratadas.length ? ' · ' + x.distratadas.length + ' distratada(s) fora da conta' : '') +
        (x.cor.chavePix ? ' · PIX ' + esc(x.cor.chavePix) : '') + '</span></h2>' +
      '<div class="paineis" style="margin:0 0 10px">' +
        '<div class="painel"><div class="rot">Combinado</div><div class="num">' + fmt.brl(x.devido) + '</div></div>' +
        '<div class="painel"><div class="rot">Pago</div><div class="num pos">' + fmt.brl(x.pago) + '</div></div>' +
        '<div class="painel"><div class="rot">Saldo</div><div class="num' + (x.saldo > 0.01 ? ' neg' : '') + '">' + fmt.brl(x.saldo) + '</div></div>' +
      '</div>' +
      (x.saldo > 0.01 ? '<button class="btn primario bt-pagar" data-id="' + esc(x.cor.id) + '" data-nome="' + esc(x.cor.nome) + '" data-saldo="' + x.saldo.toFixed(2) + '">Registrar pagamento</button>' : '') +
      '<details style="margin-top:10px"><summary class="nota" style="cursor:pointer">ver as vendas e os pagamentos</summary>' +
        x.suas.map((v) => '<div class="nota" style="padding:3px 0">• <a href="#/venda/' + esc(v.id) + '">' + esc(v.codigo || '') + '</a> Q' + v.quadra + '-L' + v.lote + ' · ' + esc(v.clienteNome || '') + ' — ' + fmt.brl(v.comissao) + '</div>').join('') +
        pagos.filter((p) => p.corretorId === x.cor.id).map((p) => '<div class="nota" style="padding:3px 0">✓ pago ' + fmt.brl(p.valor) + ' em ' + fmt.data(p.data) + (p.obs ? ' · ' + esc(p.obs) : '') + '</div>').join('') +
      '</details></div>').join('') || vazio('🤝', 'Nenhuma comissão por aqui', 'As comissões nascem nas vendas com corretor.'));

  app.querySelectorAll('.bt-pagar').forEach((b) => {
    b.onclick = () => {
      const corId = b.dataset.id, nome = b.dataset.nome, saldo = Number(b.dataset.saldo);
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
            TELAS.comissoes();
          } },
        ],
      });
    };
  });
};
