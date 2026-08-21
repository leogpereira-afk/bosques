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

// Acumulado do empreendimento desde o início (inclui o que está sem data —
// dinheiro sem data existe do mesmo jeito; o aviso da tela cobra a data).
function totaisAcumulados() {
  let entradas = 0, saidas = 0;
  for (const r of lista('rec')) entradas += Number(r.valor) || 0;
  for (const c of cxVivos()) {
    if (c.tipo === 'entrada') entradas += Number(c.valor) || 0;
    else saidas += Number(c.valor) || 0;
  }
  return { entradas, saidas, resultado: entradas - saidas };
}

/* ── DRE do empreendimento ──────────────────────────────────────────────────
   Três colunas: o mês escolhido, o ano dele e desde o início. As despesas
   abertas POR CATEGORIA — é a resposta de "para onde o dinheiro está indo".
   Sem data entra só no "desde o início". */
function dreDados(mesSel) {
  const ano = mesSel.slice(0, 4);
  const balde = () => ({ recVendas: 0, outras: {}, desp: {} });
  const b = { mes: balde(), ano: balde(), total: balde() };
  const baldesDe = (data) => {
    const out = [b.total];
    if (data) {
      if (mesDe(data) === mesSel) out.push(b.mes);
      if (String(data).startsWith(ano)) out.push(b.ano);
    }
    return out;
  };
  for (const r of lista('rec')) {
    for (const alvo of baldesDe(r.data)) alvo.recVendas += Number(r.valor) || 0;
  }
  for (const c of cxVivos()) {
    const cat = c.categoria || 'Outros';
    for (const alvo of baldesDe(c.data)) {
      const caixa2 = c.tipo === 'entrada' ? alvo.outras : alvo.desp;
      caixa2[cat] = (caixa2[cat] || 0) + (Number(c.valor) || 0);
    }
  }
  for (const k of ['mes', 'ano', 'total']) {
    const x = b[k];
    x.somaOutras = Object.values(x.outras).reduce((s, v) => s + v, 0);
    x.receita = x.recVendas + x.somaOutras;
    x.somaDesp = Object.values(x.desp).reduce((s, v) => s + v, 0);
    x.resultado = x.receita - x.somaDesp;
  }
  // Rubricas na ordem do que mais pesa no acumulado.
  b.catsDesp = Object.keys(b.total.desp).sort((a, c) => b.total.desp[c] - b.total.desp[a]);
  b.catsOutras = Object.keys(b.total.outras).sort((a, c) => b.total.outras[c] - b.total.outras[a]);
  b.mesSel = mesSel;
  b.anoRotulo = ano;   // NÃO sobrescrever b.ano — é o balde do ano!
  return b;
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

  const ac = totaisAcumulados();
  const dre = dreDados(mes);

  // ── Previsibilidade: o que os contratos vivos AINDA vão trazer, mês a mês.
  // Custo estimado = média das saídas dos últimos 3 meses com movimento (é
  // estimativa de referência, não promessa — e o papel diz isso).
  const hoje = hojeISO();
  const mesAtual = mesDe(hoje);
  const porMesPrev = {};
  let vencidoAberto = 0, aReceberTotal = 0, parcelasAbertas = 0;
  for (const v of vendasVivas()) {
    const r = CARNE.resumo(v, cfgReajuste(), recsDaVenda(v.id));
    for (const l of r.carne) {
      const falta = Math.round((l.valor - Math.min(l.pago, l.valor)) * 100) / 100;
      if (falta <= 0.004) continue;
      aReceberTotal += falta; parcelasAbertas++;
      if (l.venc && l.venc < hoje) { vencidoAberto += falta; continue; }
      const m = mesDe(l.venc);
      if (/^\d{4}-\d{2}$/.test(m)) porMesPrev[m] = (porMesPrev[m] || 0) + falta;
    }
  }
  const mesesFechados = meses.filter((m) => m < mesAtual).slice(-3);
  const custoMedio = mesesFechados.length
    ? mesesFechados.reduce((s, m) => s + totaisDoMes(m).saidas, 0) / mesesFechados.length : 0;
  const mesesPrev = Object.keys(porMesPrev).sort().filter((m) => m >= mesAtual).slice(0, 12);
  const blocoPrevisao =
    '<div class="cartao"><h2>Previsibilidade <span class="nota">— o que os contratos vivos ainda vão trazer</span></h2>' +
    '<div class="paineis" style="margin:0 0 10px">' +
      '<div class="painel"><div class="rot">A receber dos contratos</div><div class="num pos">' + fmt.brl(aReceberTotal) + '</div>' +
        '<div class="sub">' + parcelasAbertas + ' parcela(s) em aberto</div></div>' +
      '<div class="painel"><div class="rot">Já vencido (cobrar)</div><div class="num' + (vencidoAberto ? ' neg' : '') + '">' + fmt.brl(vencidoAberto) + '</div></div>' +
      '<div class="painel"><div class="rot">Custo típico por mês</div><div class="num">' + fmt.brl(custoMedio) + '</div>' +
        '<div class="sub">média dos últimos ' + mesesFechados.length + ' meses</div></div>' +
    '</div>' +
    (mesesPrev.length
      ? '<div class="rolagem"><table class="tabela"><thead><tr><th>Mês</th><th class="num">A receber (carnês)</th>' +
        '<th class="num">Custo estimado</th><th class="num">Saldo projetado</th></tr></thead><tbody>' +
        mesesPrev.map((m) => {
          const rec2 = porMesPrev[m];
          const saldo = rec2 - custoMedio;
          return '<tr><td>' + nomeMes(m) + '</td><td class="num">' + fmt.brl(rec2) + '</td>' +
            '<td class="num">' + fmt.brl(custoMedio) + '</td>' +
            '<td class="num" style="color:' + (saldo >= 0 ? 'var(--verde)' : 'var(--ruim)') + '">' + fmt.brl(saldo) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="nota" style="margin-top:8px">A coluna de custo é a MÉDIA dos últimos meses — estimativa de referência, não compromisso. O recebimento supõe as parcelas pagas em dia.</p>'
      : '<p class="nota">Nenhuma parcela futura em aberto.</p>') +
    '</div>';

  // "Para onde o dinheiro está indo": saídas por categoria, mês × acumulado,
  // com barra proporcional ao acumulado.
  const maiorDesp = Math.max(1, ...dre.catsDesp.map((c) => dre.total.desp[c]));
  const blocoDestino = dre.catsDesp.length
    ? '<div class="cartao"><h2>Para onde o dinheiro está indo <span class="nota">— saídas por categoria · clique num lançamento abaixo para reclassificar</span></h2>' +
      '<div class="rolagem"><table class="tabela"><thead><tr><th>Categoria</th><th></th>' +
      '<th class="num">' + nomeMes(mes) + '</th><th class="num">Desde o início</th><th class="num">% do total</th></tr></thead><tbody>' +
      dre.catsDesp.map((c) => {
        const vTot = dre.total.desp[c];
        const pct = Math.round(vTot / Math.max(1, dre.total.somaDesp) * 100);
        return '<tr><td>' + esc(c) + '</td>' +
          '<td style="width:34%"><div style="background:var(--verde-palido);border-radius:6px;height:12px;overflow:hidden">' +
            '<div style="width:' + Math.round(vTot / maiorDesp * 100) + '%;height:100%;background:var(--verde)"></div></div></td>' +
          '<td class="num">' + (dre.mes.desp[c] ? fmt.brl(dre.mes.desp[c]) : '—') + '</td>' +
          '<td class="num">' + fmt.brl(vTot) + '</td>' +
          '<td class="num">' + pct + '%</td></tr>';
      }).join('') +
      '<tr style="font-weight:800"><td>TOTAL</td><td></td><td class="num">' + fmt.brl(dre.mes.somaDesp) + '</td>' +
      '<td class="num">' + fmt.brl(dre.total.somaDesp) + '</td><td class="num">100%</td></tr>' +
      '</tbody></table></div></div>'
    : '';

  // O DRE do empreendimento (mês · ano · desde o início), com PDF.
  const linhaDre = (rotulo, vMes, vAno, vTot, opts = {}) =>
    '<tr' + (opts.forte ? ' style="font-weight:800;border-top:2px solid var(--borda)"' : '') + '>' +
    '<td' + (opts.recuo ? ' style="padding-left:22px;color:var(--tinta-fraca)"' : '') + '>' + rotulo + '</td>' +
    [vMes, vAno, vTot].map((v) => '<td class="num"' +
      (opts.cor ? ' style="color:' + (v >= 0 ? 'var(--verde)' : 'var(--ruim)') + '"' : '') + '>' +
      (v === 0 && opts.recuo ? '—' : fmt.brl(v)) + '</td>').join('') + '</tr>';
  const blocoDre =
    '<div class="cartao"><h2>DRE do empreendimento <span class="nota">— regime de caixa (o que de fato entrou e saiu)</span>' +
      ' <button class="btn mini" id="dre-pdf" style="float:right">📄 PDF do DRE</button></h2>' +
    '<div class="rolagem"><table class="tabela"><thead><tr><th></th>' +
      '<th class="num">' + nomeMes(mes) + '</th><th class="num">' + dre.anoRotulo + '</th><th class="num">Desde o início</th></tr></thead><tbody>' +
    linhaDre('Recebimentos de vendas (entradas e parcelas)', dre.mes.recVendas, dre.ano.recVendas, dre.total.recVendas) +
    dre.catsOutras.map((c) => linhaDre(esc(c), dre.mes.outras[c] || 0, dre.ano.outras[c] || 0, dre.total.outras[c], { recuo: true })).join('') +
    linhaDre('(=) Receita', dre.mes.receita, dre.ano.receita, dre.total.receita, { forte: true }) +
    dre.catsDesp.map((c) => linhaDre(esc(c), dre.mes.desp[c] || 0, dre.ano.desp[c] || 0, dre.total.desp[c], { recuo: true })).join('') +
    linhaDre('(−) Despesas', dre.mes.somaDesp, dre.ano.somaDesp, dre.total.somaDesp, { forte: true }) +
    linhaDre('(=) Resultado', dre.mes.resultado, dre.ano.resultado, dre.total.resultado, { forte: true, cor: true }) +
    '</tbody></table></div></div>';

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
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Total entradas · desde o início</div><div class="num pos">' + fmt.brl(ac.entradas) + '</div></div>' +
      '<div class="painel"><div class="rot">Total saídas</div><div class="num neg">' + fmt.brl(ac.saidas) + '</div></div>' +
      '<div class="painel"><div class="rot">Resultado do empreendimento</div><div class="num ' + (ac.resultado >= 0 ? 'pos' : 'neg') + '">' + fmt.brl(ac.resultado) + '</div></div>' +
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
    blocoPrevisao + blocoDestino + blocoDre +
    '<div class="cartao"><h2>Lançamentos de ' + nomeMes(mes) + ' <span class="nota">— ' + movs.length + ' · clique para editar/reclassificar</span></h2>' +
      (movs.map((m) => '<div class="lin" ' + (m.col === 'cx' ? 'data-cx="' + esc(m.id) + '"' :
          (m.vendaId ? 'data-venda="' + esc(m.vendaId) + '"' : 'style="cursor:default"')) + '>' +
        '<div class="cresce"><b>' + esc(m.descricao) + '</b>' +
        '<span class="sub">' + fmt.data(m.data) + ' · ' + esc(m.categoria) + (m.forma ? ' · ' + esc(m.forma) : '') + '</span></div>' +
        '<span class="dinheiro" style="color:' + (m.entrada ? 'var(--verde)' : 'var(--ruim)') + '">' +
          (m.entrada ? '+' : '−') + fmt.brl(m.valor) + '</span>' +
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
  app.querySelectorAll('.lin[data-cx]').forEach((el) => {
    el.onclick = () => abrirEdicaoLancamento(el.dataset.cx);
  });
  const bDre = document.getElementById('dre-pdf');
  if (bDre) bDre.onclick = () => { PDF.dre(dre, S.cfg || {}); toast('DRE em PDF gerado'); };
};

/* ── Editar/reclassificar um lançamento avulso ─────────────────────────────
   É aqui que "MENSALIDADE VITOR · Outros" vira "Funcionários": a importação
   classificou por palavra-chave e quem conhece o dinheiro corrige a categoria.
   Recebimento de venda NÃO passa por aqui (estorna na ficha da venda). */
function abrirEdicaoLancamento(id, aoTerminar) {
  const c = achar('cx', id);
  if (!c) return;
  const depois = aoTerminar || TELAS.caixa;
  const cats = c.tipo === 'saida'
    ? ((S.cfg && S.cfg.categoriasDespesa) || ['Outros'])
    : ((S.cfg && S.cfg.categoriasReceita) || ['Outros']);
  const listaCats = cats.includes(c.categoria) || !c.categoria ? cats : [c.categoria].concat(cats);
  // O fio do lançamento: quem criou e cada edição, com o que mudou. Dinheiro
  // editado sem trilha vira discussão sem resposta.
  const trilha =
    '<div class="campo"><label>Histórico</label>' +
    '<div class="nota">• criado ' + fmt.dataHora(c.criadoEm) + ' por ' + esc(c.criadoPor || '—') + '</div>' +
    (c.historico || []).map((h) => '<div class="nota">• ' + fmt.dataHora(h.em) + ' por ' + esc(h.por || '—') + ' — ' + esc(h.o_que || '') + '</div>').join('') +
    '</div>';
  const corpo =
    campo('Descrição', entrada('descricao', c.descricao || '')) +
    '<div class="colunas-3">' +
      campo('Valor (R$)', entrada('valor', c.valor, { inputmode: 'decimal' })) +
      campo('Data', entrada('data', c.data || '', { tipo: 'date' })) +
      campo('Forma', seletor('forma', c.forma || 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX'])) +
    '</div>' +
    campo('Categoria', seletor('categoria', c.categoria || 'Outros', listaCats), 'é o que separa o DRE — estrutura, funcionário, comissão…') +
    campo('Observação', entrada('obs', c.obs || '')) + trilha;
  abrirModal({
    titulo: (c.tipo === 'saida' ? 'Saída' : 'Receita') + ' — editar',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Apagar', classe: 'perigo', aoClicar: async (fundo) => {
        if (await confirmar('Apagar "' + (c.descricao || '') + '" de ' + fmt.brl(c.valor) + '? (vai para a lixeira, com registro)', { perigo: true, ok: 'Apagar' })) {
          try {
            await api('apagar', { colecao: 'cx', id: c.id });
            const arr = S.reg.cx || [];
            const i = arr.findIndex((x) => x.id === c.id);
            if (i >= 0) arr[i] = { ...arr[i], apagadoEm: new Date().toISOString() };
            gravarCache();
            fecharSilencioso(fundo);
            depois();
          } catch (err) { toast(err.message || 'Não consegui apagar agora', 'ruim'); }
        }
      } },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        const valor = numeroBR(v.valor);
        if (!(valor > 0)) { toast('Valor inválido', 'ruim'); return; }
        const desc = String(v.descricao || '').trim().slice(0, 200);
        // o QUE mudou fica escrito — é a trilha que responde "quem mexeu nisso"
        const mud = [];
        if (Math.abs(valor - (Number(c.valor) || 0)) > 0.004) mud.push('valor ' + fmt.brl(c.valor) + ' → ' + fmt.brl(valor));
        if ((v.data || '') !== (c.data || '')) mud.push('data ' + (c.data || '—') + ' → ' + (v.data || '—'));
        if ((v.categoria || '') !== (c.categoria || '')) mud.push('categoria ' + (c.categoria || '—') + ' → ' + v.categoria);
        if ((v.forma || '') !== (c.forma || '')) mud.push('forma ' + (c.forma || '—') + ' → ' + v.forma);
        if (desc !== (c.descricao || '')) mud.push('descrição alterada');
        if ((String(v.obs || '')) !== (c.obs || '')) mud.push('observação alterada');
        if (!mud.length) { fecharSilencioso(fundo); return; }
        salvar('cx', {
          id: c.id, valor, data: v.data, forma: v.forma, categoria: v.categoria,
          descricao: desc, obs: String(v.obs || '').slice(0, 300),
          historico: historiar(c, 'Editou: ' + mud.join('; ')),
        });
        fecharSilencioso(fundo);
        toast('Lançamento atualizado');
        depois();
      } },
    ],
  });
}

function abrirLancamento(tipo, aoTerminar) {
  const depois = aoTerminar || TELAS.caixa;
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
        depois();
      } },
    ],
  });
}

/* ── Tela: lançamentos (ao lado do Caixa) ───────────────────────────────────
   A lista COMPLETA e detalhada: todo dinheiro que entrou e saiu, com filtros,
   edição (só os avulsos — recebimento de venda se mexe na ficha da venda) e a
   trilha de quem fez. */
TELAS.lancamentos = function () {
  const app = document.getElementById('app');
  const meses = mesesComMovimento();
  const f = TELAS._fLanc || { q: '', tipo: '', cat: '', mes: mesDe(hojeISO()) };
  TELAS._fLanc = f;

  // combina recebimentos de venda + lançamentos avulsos
  const tudo = [];
  for (const r of lista('rec')) {
    const v = achar('venda', r.vendaId);
    tudo.push({
      col: 'rec', id: r.id, data: r.data || '', entrada: true,
      valor: Number(r.valor) || 0, forma: r.forma || '',
      categoria: 'Recebimento de venda',
      descricao: (v ? 'Q' + v.quadra + '-L' + v.lote + ' · ' + (v.clienteNome || '') : 'Venda') +
        (r.tipo === 'entrada' ? ' (entrada)' : r.parcelaN ? ' (parc. ' + r.parcelaN + ')' : ''),
      codigo: r.codigo || '', criadoPor: r.criadoPor || '—', criadoEm: r.criadoEm,
      atualizadoPor: r.atualizadoPor, vendaId: r.vendaId, obs: r.obs || '',
      nHist: 0,
    });
  }
  for (const c of cxVivos()) {
    tudo.push({
      col: 'cx', id: c.id, data: c.data || '', entrada: c.tipo === 'entrada',
      valor: Number(c.valor) || 0, forma: c.forma || '',
      categoria: c.categoria || 'Outros', descricao: c.descricao || '—',
      codigo: '', criadoPor: c.criadoPor || '—', criadoEm: c.criadoEm,
      atualizadoPor: c.atualizadoPor, obs: c.obs || '',
      nHist: (c.historico || []).length,
    });
  }

  const cats = [...new Set(tudo.map((x) => x.categoria))].sort();
  const filtrados = tudo.filter((x) => {
    if (f.mes && f.mes !== 'todos' && mesDe(x.data) !== f.mes) return false;
    if (f.mes === 'sem-data' && x.data) return false;
    if (f.tipo === 'entrada' && !x.entrada) return false;
    if (f.tipo === 'saida' && x.entrada) return false;
    if (f.cat && x.categoria !== f.cat) return false;
    if (f.q && !((x.descricao + ' ' + x.obs + ' ' + x.forma + ' ' + x.criadoPor + ' ' + x.codigo).toLowerCase().includes(f.q.toLowerCase()))) return false;
    return true;
  }).sort((a, b) => String(b.data).localeCompare(a.data));

  const somaE = filtrados.filter((x) => x.entrada).reduce((s, x) => s + x.valor, 0);
  const somaS = filtrados.filter((x) => !x.entrada).reduce((s, x) => s + x.valor, 0);

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel"><div class="rot">Lançamentos no recorte</div><div class="num">' + filtrados.length + '</div></div>' +
      '<div class="painel"><div class="rot">Entradas</div><div class="num pos">' + fmt.brl(somaE) + '</div></div>' +
      '<div class="painel"><div class="rot">Saídas</div><div class="num neg">' + fmt.brl(somaS) + '</div></div>' +
      '<div class="painel"><div class="rot">Diferença</div><div class="num ' + (somaE - somaS >= 0 ? 'pos' : 'neg') + '">' + fmt.brl(somaE - somaS) + '</div></div>' +
    '</div>' +
    '<div class="filtros">' +
      '<input type="search" id="ln-q" placeholder="descrição, quem fez, forma…" value="' + esc(f.q) + '">' +
      '<select id="ln-mes"><option value="todos"' + (f.mes === 'todos' ? ' selected' : '') + '>Todos os meses</option>' +
        '<option value="sem-data"' + (f.mes === 'sem-data' ? ' selected' : '') + '>Sem data</option>' +
        meses.slice().reverse().map((m) => '<option value="' + m + '"' + (f.mes === m ? ' selected' : '') + '>' + nomeMes(m) + '</option>').join('') + '</select>' +
      '<select id="ln-tipo"><option value="">Entradas e saídas</option>' +
        '<option value="entrada"' + (f.tipo === 'entrada' ? ' selected' : '') + '>Só entradas</option>' +
        '<option value="saida"' + (f.tipo === 'saida' ? ' selected' : '') + '>Só saídas</option></select>' +
      '<select id="ln-cat"><option value="">Todas as categorias</option>' +
        cats.map((c) => '<option' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
      '<button class="btn primario" id="ln-desp">− Despesa</button>' +
      '<button class="btn" id="ln-rece">+ Receita</button>' +
    '</div>' +
    (filtrados.map((x) =>
      '<div class="lin" data-col="' + x.col + '" data-id="' + esc(x.id) + '" ' + (x.col === 'rec' ? 'data-venda="' + esc(x.vendaId) + '"' : '') + '>' +
      '<div class="cresce"><b>' + esc(x.descricao) + (x.codigo ? ' <span class="nota">' + esc(x.codigo) + '</span>' : '') + '</b>' +
      '<span class="sub">' + (x.data ? fmt.data(x.data) : '⚠ SEM DATA') + ' · ' + esc(x.categoria) +
        (x.forma ? ' · ' + esc(x.forma) : '') +
        ' · por ' + esc(x.criadoPor) +
        (x.nHist ? ' · ✏️ ' + x.nHist + ' edição(ões)' : '') +
        (x.obs ? ' · ' + esc(x.obs) : '') + '</span></div>' +
      '<span class="dinheiro" style="color:' + (x.entrada ? 'var(--verde)' : 'var(--ruim)') + '">' +
        (x.entrada ? '+' : '−') + fmt.brl(x.valor) + '</span>' +
      '</div>').join('') || vazio('🧾', 'Nada nesse recorte'));

  document.getElementById('ln-q').oninput = (e) => { f.q = e.target.value; TELAS.lancamentos(); };
  document.getElementById('ln-mes').onchange = (e) => { f.mes = e.target.value; TELAS.lancamentos(); };
  document.getElementById('ln-tipo').onchange = (e) => { f.tipo = e.target.value; TELAS.lancamentos(); };
  document.getElementById('ln-cat').onchange = (e) => { f.cat = e.target.value; TELAS.lancamentos(); };
  document.getElementById('ln-desp').onclick = () => abrirLancamento('saida', TELAS.lancamentos);
  document.getElementById('ln-rece').onclick = () => abrirLancamento('entrada', TELAS.lancamentos);
  app.querySelectorAll('.lin[data-col]').forEach((el) => {
    el.onclick = () => {
      if (el.dataset.col === 'cx') abrirEdicaoLancamento(el.dataset.id, TELAS.lancamentos);
      else location.hash = '#/venda/' + el.dataset.venda;
    };
  });
};
