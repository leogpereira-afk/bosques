/* PDF — proposta e recibo. jsPDF vendorado (libs/), só Helvetica (registrar
   outra fonte sem todos os estilos derruba para Times sem avisar). */

const PDF = (() => {
  const VERDE = [14, 83, 43];
  const VERDE_CLARO = [139, 195, 74];
  const CINZA = [95, 122, 102];

  const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dataBR = (iso) => iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR') : '';

  function novo() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: 'mm', format: 'a4' });
  }

  // A logomarca entra em TODO cabeçalho. Pré-carregada uma vez (dataURL); se
  // o fetch falhar (offline no primeiro uso), o cabeçalho cai no texto — o
  // PDF nunca deixa de sair por causa da imagem.
  let LOGO = null;
  fetch('icons/logo-pdf.png')
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => {
      if (!b) return;
      const fr = new FileReader();
      fr.onload = () => { LOGO = fr.result; };
      fr.readAsDataURL(b);
    })
    .catch(() => { /* segue com texto */ });

  function cabecalho(doc, cfg, titulo) {
    doc.setFillColor(...VERDE);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setFillColor(...VERDE_CLARO);
    doc.rect(0, 30, 210, 1.6, 'F');                 // o filete da marca
    if (LOGO) {
      // fundo da logo = o MESMO verde da faixa: emenda invisível
      try { doc.addImage(LOGO, 'PNG', 9, 2, 49.5, 26); } catch (e) { /* cai no texto */ }
    }
    if (!LOGO) {
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('PORTAL DOS BOSQUES', 14, 14);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(197, 225, 165);
      doc.text(((cfg.empresa && cfg.empresa.nome) || 'Associação Campestre Portal dos Bosques'), 14, 20);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(titulo, 196, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(197, 225, 165);
    doc.text('Associação Campestre Portal dos Bosques · Montes Claros/MG', 196, 20, { align: 'right' });
  }

  function rodape(doc, texto) {
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text(texto, 105, 288, { align: 'center' });
    doc.setFontSize(7);
    doc.text('developed by Léo Gonçalves', 105, 292.5, { align: 'center' });
  }

  // ── Proposta: 1 página limpa ──────────────────────────────────────────────
  function proposta(p, lote, cfg) {
    const doc = novo();
    cabecalho(doc, cfg, 'PROPOSTA ' + (p.codigo || 'sem número'));

    let y = 44;
    doc.setTextColor(30, 43, 33);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Proposta para ' + ((p.cliente && p.cliente.nome) || ''), 14, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.setTextColor(...CINZA);
    y += 6;
    doc.text('Gerada em ' + dataBR(p.enviadaEm || new Date().toISOString()) +
      ' · válida por ' + (p.validadeDias || 7) + ' dias' +
      (p.donoNome ? ' · corretor: ' + p.donoNome : ''), 14, y);

    // O lote
    y += 12;
    doc.setFillColor(232, 243, 233);
    doc.roundedRect(14, y - 6, 182, 26, 3, 3, 'F');
    doc.setTextColor(...VERDE);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('Quadra ' + p.quadra + ' · Lote ' + p.lote, 20, y + 4);
    doc.setTextColor(30, 43, 33);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text((p.areaM2 ? p.areaM2.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' m²' : '') +
      (lote && lote.rua ? ' · ' + lote.rua : ''), 20, y + 12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(brl(p.valor), 190, y + 8, { align: 'right' });

    // O plano
    y += 34;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.setTextColor(30, 43, 33);
    doc.text('Plano de pagamento', 14, y);
    y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    // O plano REDUZIDO para o cliente: na parcela reajustada, os degraus dos
    // primeiros anos (1–12, 13–24…) em vez de uma linha vaga — é o que o
    // comprador quer saber: "quanto pago em cada fase".
    const avista = (p.tipoParcela === 'À vista') || !(p.qtdeParcelas > 0);
    const linhas = avista ? [['Pagamento à vista', brl(p.entrada)]] : [['Entrada', brl(p.entrada)]];
    const nParc = avista ? 0 : (p.qtdeParcelas || 0);
    if (nParc > 0) {
      if (p.tipoParcela === 'Reajustada') {
        const pct = ((cfg.reajuste || {}).pct) || 6;
        const aCada = ((cfg.reajuste || {}).aCada) || 12;
        const degraus = Math.ceil(nParc / aCada);
        const mostrar = Math.min(degraus, 4);
        for (let d = 0; d < mostrar; d++) {
          const ini = d * aCada + 1;
          const fim = Math.min(nParc, (d + 1) * aCada);
          linhas.push(['Parcelas ' + ini + ' a ' + fim, brl(p.valorParcela * Math.pow(1 + pct / 100, d)) + ' /mês']);
        }
        if (degraus > mostrar) {
          linhas.push(['… e segue +' + pct + '% a cada ' + aCada + ' parcelas',
            'última (' + nParc + 'ª): ' + brl(p.valorParcela * Math.pow(1 + pct / 100, degraus - 1))]);
        }
      } else {
        linhas.push([nParc + ' parcelas mensais fixas', brl(p.valorParcela) + ' /mês']);
      }
    }
    if (p.formaPg) linhas.push(['Forma de pagamento', String(p.formaPg)]);
    linhas.push(['Total do plano', brl(p.valor)]);
    for (const [a, b] of linhas) {
      doc.setTextColor(...CINZA); doc.text(a, 14, y);
      doc.setTextColor(30, 43, 33); doc.setFont('helvetica', 'bold');
      doc.text(b, 196, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 7;
      doc.setDrawColor(220, 231, 221);
      doc.line(14, y - 4.5, 196, y - 4.5);
    }

    const conta = (cfg.empresa && cfg.empresa.contaBancaria || '').trim();
    if (conta) {
      y += 6;
      doc.setFillColor(240, 246, 240);
      const linhasConta = doc.splitTextToSize(conta, 172);
      const altura = 12 + linhasConta.length * 4.6;
      doc.roundedRect(14, y - 4, 182, altura, 3, 3, 'F');
      doc.setTextColor(...VERDE);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.text('DADOS PARA PAGAMENTO', 19, y + 1.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.setTextColor(30, 43, 33);
      doc.text(linhasConta, 19, y + 7);
      y += altura;
    }
    y += 8;
    doc.setFontSize(9); doc.setTextColor(...CINZA);
    const obsTxt = 'Esta proposta é uma simulação de compra e não vale como contrato. Valores sujeitos a ' +
      'confirmação de disponibilidade do lote no ato da assinatura. Documentação e condições finais são ' +
      'formalizadas no contrato de adesão.';
    doc.text(doc.splitTextToSize(obsTxt, 182), 14, y);

    y += 22;
    doc.setFillColor(...VERDE_CLARO);
    doc.roundedRect(14, y, 182, 16, 3, 3, 'F');
    doc.setTextColor(12, 32, 18);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Gostou? Responda no WhatsApp' + (p.donoNome ? ' do corretor ' + p.donoNome : '') +
      (p.corretorTel ? ' · ' + p.corretorTel : ''), 105, y + 10, { align: 'center' });

    rodape(doc, 'Associação Campestre Portal dos Bosques · Montes Claros/MG · proposta ' + (p.codigo || ''));
    return doc.output('blob');
  }

  // ── Recibo de recebimento ─────────────────────────────────────────────────
  function recibo(rc, venda, cfg) {
    const doc = novo();
    cabecalho(doc, cfg, 'RECIBO ' + (rc.codigo || ''));
    let y = 48;
    doc.setTextColor(30, 43, 33);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text(brl(rc.valor), 105, y, { align: 'center' });
    y += 12;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const desc = 'Recebemos de ' + (venda.clienteNome || '—') + ' a quantia de ' + brl(rc.valor) +
      ', em ' + dataBR(rc.data) + (rc.forma ? ' via ' + rc.forma : '') +
      ', referente a ' + (rc.tipo === 'entrada' ? 'ENTRADA' : rc.parcelaN ? 'parcela ' + rc.parcelaN + ' de ' + (venda.qtdeParcelas || '') : 'pagamento') +
      ' do lote Quadra ' + venda.quadra + ' Lote ' + venda.lote + ' (' + (venda.codigo || '') + ') no Portal dos Bosques.' +
      (rc.obs ? ' Obs.: ' + rc.obs : '');
    doc.text(doc.splitTextToSize(desc, 170), 20, y);
    y += 44;
    doc.setDrawColor(30, 43, 33);
    doc.line(60, y, 150, y);
    doc.setFontSize(9); doc.setTextColor(...CINZA);
    doc.text((cfg.empresa && cfg.empresa.nome) || 'Portal dos Bosques', 105, y + 5, { align: 'center' });
    doc.text('Emitido em ' + dataBR(new Date().toISOString()) + ' por ' + (S.quem || '—'), 105, y + 10, { align: 'center' });
    rodape(doc, 'Recibo ' + (rc.codigo || '') + ' · gerado pelo sistema Portal dos Bosques');
    salvarNoAparelho(doc.output('blob'), 'Recibo-' + (rc.codigo || 'bosques') + '.pdf');
  }

  /* ── Tabela paginada ────────────────────────────────────────────────────────
     jsPDF não quebra página sozinho: com 150 parcelas a tabela precisa saber
     recomeçar (com cabeçalho) a cada página. `cols` = [{t, x, alinha}]. */
  function tabelaPaginada(doc, cols, linhas, y, tituloRodape) {
    const cabecalhoTabela = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.setTextColor(...CINZA);
      for (const c of cols) doc.text(c.t.toUpperCase(), c.x, y, { align: c.alinha || 'left' });
      doc.setDrawColor(220, 231, 221);
      doc.line(14, y + 1.5, 196, y + 1.5);
      y += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    };
    cabecalhoTabela();
    for (const linha of linhas) {
      if (y > 276) {
        rodape(doc, tituloRodape);
        doc.addPage();
        y = 18;
        cabecalhoTabela();
      }
      for (let i = 0; i < cols.length; i++) {
        const cel = linha[i];
        const txt2 = (cel && typeof cel === 'object') ? cel.t : cel;
        if (cel && typeof cel === 'object' && cel.cor) doc.setTextColor(...cel.cor);
        else doc.setTextColor(30, 43, 33);
        if (cel && typeof cel === 'object' && cel.negrito) doc.setFont('helvetica', 'bold');
        doc.text(String(txt2 == null ? '' : txt2), cols[i].x, y, { align: cols[i].alinha || 'left' });
        if (cel && typeof cel === 'object' && cel.negrito) doc.setFont('helvetica', 'normal');
      }
      y += 5.2;
    }
    doc.setTextColor(30, 43, 33);
    return y;
  }

  const corSituacao = {
    atrasada: [198, 40, 40], parcial: [230, 108, 0], hoje: [178, 106, 0],
    paga: [0, 105, 92], aberta: [95, 122, 102],
  };
  const rotSituacao = {
    atrasada: 'ATRASADA', parcial: 'paga em parte', hoje: 'vence hoje',
    paga: 'paga', aberta: 'em aberto',
  };
  const trunca = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  // ── Ficha da venda (o dash de UMA venda): dados + carnê + recebimentos ─────
  function venda(v, r, recs, cfg) {
    const doc = novo();
    const rod = 'Ficha da venda ' + (v.codigo || '') + ' · gerada em ' +
      dataBR(new Date().toISOString()) + ' por ' + (S.quem || '—');
    cabecalho(doc, cfg, 'VENDA ' + (v.codigo || ''));

    let y = 42;
    doc.setTextColor(30, 43, 33);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Q' + v.quadra + '-L' + v.lote + ' — ' + trunca(v.clienteNome || '?', 40), 14, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.setTextColor(...CINZA);
    y += 6;
    const sit = v.situacao || 'ativa';
    doc.text('Situação: ' + sit.toUpperCase() +
      ' · venda em ' + dataBR(v.dataVenda || v.criadoEm) +
      (v.corretorNome ? ' · corretor: ' + v.corretorNome + (v.comissao ? ' (comissão ' + brl(v.comissao) + ')' : '') : ''), 14, y);
    y += 5;
    doc.text('Plano: ' + brl(v.entrada) + ' de entrada + ' + (v.qtdeParcelas || 0) + '× ' +
      brl(v.valorParcela) + ' (' + (v.tipoParcela || 'Fixa') + ')' +
      (sit === 'distratada' && v.distrato ? ' · DISTRATADA em ' + dataBR(v.distrato.em) : ''), 14, y);

    // Painéis: contrato | pago | saldo | em atraso
    y += 8;
    const paineis = [
      ['CONTRATO', brl(r.total), [30, 43, 33]],
      ['PAGO (' + (r.total ? Math.round(r.pago / r.total * 100) : 0) + '%)', brl(r.pago), [46, 125, 50]],
      ['SALDO', brl(r.saldo), [30, 43, 33]],
      ['EM ATRASO (' + r.qtdAtraso + ' parc.)', brl(r.emAtraso), r.qtdAtraso ? [198, 40, 40] : [95, 122, 102]],
    ];
    paineis.forEach(([rot, valTxt, cor], i) => {
      const x = 14 + i * 46.5;
      doc.setFillColor(240, 246, 240);
      doc.roundedRect(x, y - 4, 44, 15, 2, 2, 'F');
      doc.setFontSize(7); doc.setTextColor(...CINZA);
      doc.text(rot, x + 3, y);
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.setTextColor(...cor);
      doc.text(valTxt, x + 3, y + 7);
      doc.setFont('helvetica', 'normal');
    });
    y += 20;

    // Carnê
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.setTextColor(30, 43, 33);
    doc.text('Carnê', 14, y);
    y += 6;
    const colsCarne = [
      { t: 'Parcela', x: 14 }, { t: 'Vence', x: 58 },
      { t: 'Valor', x: 112, alinha: 'right' }, { t: 'Pago', x: 142, alinha: 'right' },
      { t: 'Situação', x: 152 },
    ];
    const linhasCarne = r.carne.map((l) => [
      l.rotulo, dataBR(l.venc), brl(l.valor), l.pago ? brl(l.pago) : '—',
      { t: rotSituacao[l.situacao] || l.situacao, cor: corSituacao[l.situacao], negrito: l.situacao === 'atrasada' },
    ]);
    y = tabelaPaginada(doc, colsCarne, linhasCarne, y, rod);

    // Recebimentos
    if ((recs || []).length) {
      if (y > 240) { rodape(doc, rod); doc.addPage(); y = 18; }
      y += 6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('Recebimentos (' + recs.length + ')', 14, y);
      y += 6;
      const colsRec = [
        { t: 'Recibo', x: 14 }, { t: 'Data', x: 44 }, { t: 'Valor', x: 96, alinha: 'right' },
        { t: 'Forma', x: 104 }, { t: 'Por / obs.', x: 134 },
      ];
      const ordenados = recs.slice().sort((a, b) => String(a.data || '').localeCompare(b.data || ''));
      const linhasRec = ordenados.map((rc) => [
        rc.codigo || '—', dataBR(rc.data), brl(rc.valor), trunca(rc.forma, 14),
        trunca((rc.criadoPor || '—') + (rc.obs ? ' · ' + rc.obs : ''), 34),
      ]);
      y = tabelaPaginada(doc, colsRec, linhasRec, y, rod);
    }
    rodape(doc, rod);
    salvarNoAparelho(doc.output('blob'), 'Venda-' + (v.codigo || 'bosques') + '-Q' + v.quadra + 'L' + v.lote + '.pdf');
  }

  // ── Dash de vendas: o retrato geral OU do recorte filtrado ─────────────────
  // `itens` = [{v, r}] exatamente como a tela mostra; `recorte` descreve o
  // filtro ("todas", "só em atraso", "quadra 3"…) e sai escrito no papel —
  // um PDF de recorte sem dizer o recorte viraria "o total" na reunião.
  function vendasDash(itens, recorte, cfg) {
    const doc = novo();
    const hojeTxt = dataBR(new Date().toISOString());
    const rod = 'Vendas — ' + recorte + ' · gerado em ' + hojeTxt + ' por ' + (S.quem || '—');
    cabecalho(doc, cfg, 'VENDAS · ' + hojeTxt);

    let y = 40;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.setTextColor(30, 43, 33);
    doc.text('Retrato: ' + recorte, 14, y);
    y += 8;

    const vivas = itens.filter(({ v }) => ['ativa', 'conferir'].includes(v.situacao || 'ativa'));
    const emAtraso = vivas.filter(({ r }) => r.qtdAtraso > 0);
    const somaContrato = itens.reduce((s, x) => s + x.r.total, 0);
    const somaPago = itens.reduce((s, x) => s + x.r.pago, 0);
    const somaAtraso = emAtraso.reduce((s, x) => s + x.r.emAtraso, 0);
    const paineis = [
      ['CONTRATOS', String(itens.length) + (vivas.length !== itens.length ? ' (' + vivas.length + ' vivos)' : ''), [30, 43, 33]],
      ['SOMA DOS CONTRATOS', brl(somaContrato), [30, 43, 33]],
      ['JÁ PAGO', brl(somaPago), [46, 125, 50]],
      ['EM ATRASO (' + emAtraso.length + ')', brl(somaAtraso), emAtraso.length ? [198, 40, 40] : [95, 122, 102]],
    ];
    paineis.forEach(([rot, valTxt, cor], i) => {
      const x = 14 + i * 46.5;
      doc.setFillColor(240, 246, 240);
      doc.roundedRect(x, y - 4, 44, 15, 2, 2, 'F');
      doc.setFontSize(6.6); doc.setTextColor(...CINZA);
      doc.text(rot, x + 3, y);
      doc.setFontSize(10.5); doc.setFont('helvetica', 'bold');
      doc.setTextColor(...cor);
      doc.text(valTxt, x + 3, y + 7);
      doc.setFont('helvetica', 'normal');
    });
    y += 22;

    const cols = [
      { t: 'Venda', x: 14 }, { t: 'Lote', x: 31 }, { t: 'Cliente', x: 45 },
      { t: 'Corretor', x: 95 }, { t: 'Sit.', x: 124 },
      { t: 'Contrato', x: 152, alinha: 'right' }, { t: 'Pago', x: 172, alinha: 'right' },
      { t: 'Atraso', x: 196, alinha: 'right' },
    ];
    const abrevSit = { ativa: 'ativa', conferir: 'conferir', quitada: 'quitada', distratada: 'distrat.' };
    const linhas = itens.map(({ v, r }) => [
      v.codigo || '—', 'Q' + v.quadra + '-L' + v.lote, trunca(v.clienteNome, 27),
      trunca((v.corretorNome || '—').split(' ')[0] + ' ' + ((v.corretorNome || '').split(' ')[1] || ''), 15),
      abrevSit[v.situacao || 'ativa'] || v.situacao,
      brl(r.total), brl(r.pago),
      r.qtdAtraso > 0 && ['ativa', 'conferir'].includes(v.situacao || 'ativa')
        ? { t: brl(r.emAtraso), cor: [198, 40, 40], negrito: true } : '—',
    ]);
    linhas.push([
      { t: 'TOTAL', negrito: true }, '', '', '', '',
      { t: brl(somaContrato), negrito: true }, { t: brl(somaPago), negrito: true },
      { t: brl(somaAtraso), negrito: true, cor: somaAtraso ? [198, 40, 40] : [30, 43, 33] },
    ]);
    tabelaPaginada(doc, cols, linhas, y, rod);
    rodape(doc, rod);
    salvarNoAparelho(doc.output('blob'), 'Vendas-Bosques-' + new Date().toISOString().slice(0, 10) +
      (recorte === 'todas as vendas' ? '' : '-recorte') + '.pdf');
  }

  // ── DRE do empreendimento (mês · ano · desde o início) ─────────────────────
  // Recebe o objeto pronto de dreDados() — o PDF é o retrato da tela, nunca
  // uma segunda conta que possa divergir dela.
  function dre(d, cfg) {
    const doc = novo();
    const nomeMes2 = (m) => {
      const [a, mm] = String(m).split('-');
      return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1] + '/' + a;
    };
    const rod = 'DRE do empreendimento · regime de caixa · gerado em ' +
      dataBR(new Date().toISOString()) + ' por ' + (S.quem || '—');
    cabecalho(doc, cfg, 'DRE · ' + nomeMes2(d.mesSel));

    let y = 42;
    doc.setTextColor(30, 43, 33);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Demonstração do resultado — regime de caixa', 14, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.setTextColor(...CINZA);
    y += 5.5;
    doc.text('O que de fato entrou e saiu. Lançamento sem data conta só no "desde o início".', 14, y);
    y += 9;

    const cols = [
      { t: '', x: 14 },
      { t: nomeMes2(d.mesSel), x: 118, alinha: 'right' },
      { t: d.anoRotulo, x: 156, alinha: 'right' },
      { t: 'Desde o início', x: 196, alinha: 'right' },
    ];
    const VERDE_TXT = [46, 125, 50], VERM = [198, 40, 40];
    const linha = (rot, vm, va, vt, o = {}) => [
      o.forte ? { t: rot, negrito: true } : (o.recuo ? '   · ' + rot : rot),
      ...[vm, va, vt].map((v) => {
        const cel = { t: (v === 0 && o.recuo) ? '—' : brl(v) };
        if (o.forte) cel.negrito = true;
        if (o.cor) cel.cor = v >= 0 ? VERDE_TXT : VERM;
        return cel;
      }),
    ];
    const linhas = [
      linha('Recebimentos de vendas (entradas e parcelas)', d.mes.recVendas, d.ano.recVendas, d.total.recVendas),
      ...d.catsOutras.map((c) => linha(c, d.mes.outras[c] || 0, d.ano.outras[c] || 0, d.total.outras[c], { recuo: true })),
      linha('(=) Receita', d.mes.receita, d.ano.receita, d.total.receita, { forte: true }),
      ...d.catsDesp.map((c) => linha(c, d.mes.desp[c] || 0, d.ano.desp[c] || 0, d.total.desp[c], { recuo: true })),
      linha('(-) Despesas', d.mes.somaDesp, d.ano.somaDesp, d.total.somaDesp, { forte: true }),
      linha('(=) RESULTADO', d.mes.resultado, d.ano.resultado, d.total.resultado, { forte: true, cor: true }),
    ];
    tabelaPaginada(doc, cols, linhas, y, rod);
    rodape(doc, rod);
    salvarNoAparelho(doc.output('blob'), 'DRE-Bosques-' + d.mesSel + '.pdf');
  }

  // ── Espelho de vendas em PDF: o mapa das quadras para levar/mandar ─────────
  function espelho(ls, atrasos, cfg) {
    const doc = novo();
    const hojeTxt = dataBR(new Date().toISOString());
    const rod = 'Espelho de vendas · ' + hojeTxt + ' · gerado por ' + (S.quem || '—');
    cabecalho(doc, cfg, 'ESPELHO · ' + hojeTxt);

    let y = 40;
    const disp = ls.filter((l) => l.status === 'Disponível').length;
    const vend = ls.filter((l) => l.status === 'Vendido').length;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.setTextColor(30, 43, 33);
    doc.text(ls.length + ' lotes · ' + disp + ' disponíveis · ' + vend + ' vendidos (' +
      Math.round(vend / Math.max(1, ls.length) * 100) + '%)', 14, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text('cinza = vendido · branco = disponível (com o preço) · ! = parcela em atraso', 196, y, { align: 'right' });
    y += 6;

    const quadras = [...new Set(ls.map((l) => l.quadra))].sort((a, b) => a - b);
    const LARG = 18.2, ALT = 12.5, PORLINHA = 10;
    for (const q of quadras) {
      const doQ = ls.filter((l) => l.quadra === q);
      const linhasQ = Math.ceil(doQ.length / PORLINHA);
      if (y + 8 + linhasQ * (ALT + 1.6) > 282) { rodape(doc, rod); doc.addPage(); y = 16; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.setTextColor(...VERDE);
      doc.text('Quadra ' + q, 14, y + 4);
      doc.setTextColor(...CINZA); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(doQ.filter((l) => l.status === 'Disponível').length + ' disponíveis de ' + doQ.length, 40, y + 4);
      y += 7;
      doQ.forEach((l, i) => {
        const x = 14 + (i % PORLINHA) * LARG;
        const yc = y + Math.floor(i / PORLINHA) * (ALT + 1.6);
        const vendido = l.status === 'Vendido';
        if (vendido) { doc.setFillColor(236, 236, 235); doc.setDrawColor(220, 220, 218); }
        else if (l.status === 'Reservado') { doc.setFillColor(255, 248, 236); doc.setDrawColor(240, 221, 181); }
        else { doc.setFillColor(255, 255, 255); doc.setDrawColor(139, 195, 74); }
        doc.roundedRect(x, yc, LARG - 1.4, ALT, 1.6, 1.6, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        doc.setTextColor(...(vendido ? [130, 130, 128] : [30, 43, 33]));
        doc.text(String(l.lote), x + 1.8, yc + 4.6);
        if (atrasos && atrasos.has(l.id)) {
          doc.setTextColor(...[198, 40, 40]);
          doc.text('!', x + LARG - 4.4, yc + 4.6);
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.6);
        doc.setTextColor(...(vendido ? [150, 150, 148] : CINZA));
        doc.text((Number(l.areaM2) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' m²', x + 1.8, yc + 7.6);
        doc.setFontSize(6.2);
        if (vendido) {
          doc.text('Vendido', x + 1.8, yc + 10.8);
        } else {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...VERDE);
          doc.text('R$ ' + Math.round(Number(l.preco) || 0).toLocaleString('pt-BR'), x + 1.8, yc + 10.8);
          doc.setFont('helvetica', 'normal');
        }
      });
      y += linhasQ * (ALT + 1.6) + 4;
    }
    rodape(doc, rod);
    salvarNoAparelho(doc.output('blob'), 'Espelho-Bosques-' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  // ── Relatório do empreendimento (a aba Relatórios, no papel) ───────────────
  function relatorio(d, cfg) {
    const doc = novo();
    const hojeTxt = dataBR(new Date().toISOString());
    const rod = 'Relatório do empreendimento (' + d.rotuloHz + ') · ' + hojeTxt + ' · por ' + (S.quem || '—');
    cabecalho(doc, cfg, 'RELATÓRIO · ' + hojeTxt);
    let y = 42;
    doc.setTextColor(30, 43, 33);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Retrato do empreendimento — horizonte: ' + d.rotuloHz, 14, y);
    y += 9;
    const paineis = [
      ['LOTES VENDIDOS', String(d.vendidos), [30, 43, 33]],
      ['VGV VENDIDO', brl(d.vgv), [30, 43, 33]],
      ['JÁ RECEBIDO', brl(d.recebido), [46, 125, 50]],
      ['JÁ GASTO', brl(d.gasto), [198, 40, 40]],
    ];
    const paineis2 = [
      ['A RECEBER (' + d.rotuloHz.toUpperCase() + ')', brl(d.aReceber), [46, 125, 50]],
      ['VENCIDO A COBRAR', brl(d.vencido), d.vencido ? [198, 40, 40] : [95, 122, 102]],
      ['GASTOS PREVISTOS', brl(d.previsto), [30, 43, 33]],
      ['SALDO PROJETADO', brl(d.aReceber - d.previsto), d.aReceber - d.previsto >= 0 ? [46, 125, 50] : [198, 40, 40]],
    ];
    for (const grupo of [paineis, paineis2]) {
      grupo.forEach(([rot, valTxt, cor], i) => {
        const x = 14 + i * 46.5;
        doc.setFillColor(240, 246, 240);
        doc.roundedRect(x, y - 4, 44, 15, 2, 2, 'F');
        doc.setFontSize(6.4); doc.setTextColor(...CINZA);
        doc.text(rot, x + 3, y);
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.setTextColor(...cor);
        doc.text(valTxt, x + 3, y + 7);
        doc.setFont('helvetica', 'normal');
      });
      y += 19;
    }
    y += 4;
    if (d.grupos && d.grupos.length) {
      const cols = [
        { t: d.hz === 'total' ? 'Ano' : 'Mês', x: 14 },
        { t: 'A receber', x: 120, alinha: 'right' },
        { t: 'Previstos', x: 158, alinha: 'right' },
        { t: 'Saldo projetado', x: 196, alinha: 'right' },
      ];
      const linhas = d.grupos.map((g) => [g.rotulo, brl(g.rec), g.prev ? brl(g.prev) : '—',
        { t: brl(g.rec - g.prev), cor: g.rec - g.prev >= 0 ? [46, 125, 50] : [198, 40, 40] }]);
      linhas.push([{ t: 'TOTAL', negrito: true }, { t: brl(d.aReceber), negrito: true },
        { t: brl(d.previsto), negrito: true }, { t: brl(d.aReceber - d.previsto), negrito: true }]);
      tabelaPaginada(doc, cols, linhas, y, rod);
    }
    rodape(doc, rod);
    salvarNoAparelho(doc.output('blob'), 'Relatorio-Bosques-' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  return { proposta, recibo, venda, vendasDash, dre, espelho, relatorio };
})();
