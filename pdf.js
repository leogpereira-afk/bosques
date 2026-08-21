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

  function cabecalho(doc, cfg, titulo) {
    doc.setFillColor(...VERDE);
    doc.rect(0, 0, 210, 26, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('PORTAL DOS BOSQUES', 14, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(197, 225, 165);
    doc.text(((cfg.empresa && cfg.empresa.nome) || 'Associação Campestre Portal dos Bosques'), 14, 18);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(titulo, 196, 15, { align: 'right' });
  }

  function rodape(doc, texto) {
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text(texto, 105, 290, { align: 'center' });
  }

  // ── Proposta: 1 página limpa ──────────────────────────────────────────────
  function proposta(p, lote, cfg) {
    const doc = novo();
    cabecalho(doc, cfg, 'PROPOSTA ' + (p.codigo || ''));

    let y = 40;
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
    const linhas = [
      ['Entrada', brl(p.entrada)],
      [(p.qtdeParcelas || 0) + ' parcelas mensais', brl(p.valorParcela) + (p.tipoParcela === 'Reajustada'
        ? '  (reajuste de ' + (((cfg.reajuste || {}).pct) || 6) + '% a cada ' + (((cfg.reajuste || {}).aCada) || 12) + ' parcelas)'
        : '  (valor fixo até o fim)')],
      ['Total do plano', brl(p.valor)],
    ];
    for (const [a, b] of linhas) {
      doc.setTextColor(...CINZA); doc.text(a, 14, y);
      doc.setTextColor(30, 43, 33); doc.setFont('helvetica', 'bold');
      doc.text(b, 196, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 7;
      doc.setDrawColor(220, 231, 221);
      doc.line(14, y - 4.5, 196, y - 4.5);
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
    let y = 44;
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
    doc.save('Recibo-' + (rc.codigo || 'bosques') + '.pdf');
  }

  return { proposta, recibo };
})();
