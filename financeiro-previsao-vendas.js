/* Leitura da carteira dos contratos, por vencimento. Não altera o carnê,
 * recebimentos, títulos ou caixa; consome somente o resumo já conferido. */
const FIN_PREVISAO_VENDAS = (() => {
  const numero = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') &&
    Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 100) : null;
  const reais = c => c / 100;
  const dataValida = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') &&
    !Number.isNaN(Date.parse(d + 'T12:00:00Z')) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
  const ativa = v => v && !v.apagadoEm && !v.incorporadaEmVendaId &&
    ['ativa', 'conferir', 'quitada'].includes(v.situacao || 'ativa');
  const soma = (itens, campo) => reais(itens.reduce((n, x) => n + (numero(x[campo]) || 0), 0));
  function nomeLotes(v) {
    const ls = Array.isArray(v.lotes) && v.lotes.length ? v.lotes : [{quadra:v.quadra, lote:v.lote}];
    return [...new Set(ls.filter(l => l && l.quadra != null && l.lote != null)
      .map(l => 'Q' + l.quadra + ' L' + l.lote))].join(' + ') || 'Lote não informado';
  }
  function montar(contratos = [], hoje = '') {
    const candidatos = [], pendencias = [], planos = [], itens = [], naoAlocado = [], creditos = [], idsVendas = new Set();
    function linha(v, p, i, origem) {
      const fonte = Array.isArray(v.parcelas) && Number.isInteger(p.n) && p.n > 0 ? v.parcelas[p.n - 1] : null;
      // O motor usa legado-N para uma parcela sem identidade na origem. Essa
      // chave só é única dentro da venda, não é um título compartilhado.
      const tid = fonte ? String(fonte.tid || '') : /^legado-\d+$/.test(String(p.tid || '')) ? '' : String(p.tid || '');
      return {id:String(v.id || 'sem-venda') + ':' + (tid || 'parcela-' + i), vendaId:String(v.id || ''),
        cliente:String(v.clienteNome || 'Cliente não informado'), lotes:nomeLotes(v), tid,
        rotulo:String(p.rotulo || (p.n === 0 ? 'Entrada' : (p.n || i + 1) + 'ª parcela')),
        venc:String(p.venc || ''), recebido:0, aberto:0, previsto:0, origem, motivo:'', codigoMotivo:'', credito:0,
        valorReferencia:numero(p.saldo) != null ? reais(numero(p.saldo)) : numero(p.valor) != null ? reais(numero(p.valor)) : null};
    }
    function pendente(l, codigo, motivo) { pendencias.push({...l, recebido:0, aberto:0, previsto:0, credito:0, codigoMotivo:codigo, motivo}); }
    for (const registro of contratos) {
      const v = registro?.venda, r = registro?.resumo;
      if (!ativa(v) || !r) continue;
      // Receber a mesma venda duas vezes não deve duplicar sua carteira.
      if (v.id && idsVendas.has(String(v.id))) continue;
      if (v.id) idsVendas.add(String(v.id));
      const carne = Array.isArray(r.carne) ? r.carne : [];
      if (!r.semEspelho && numero(r.naoAlocado) > 0) {
        const l = linha(v, {rotulo:'Recebimento sem parcela', valor:r.naoAlocado}, 'nao-alocado', 'recebimento');
        naoAlocado.push({...l, id:String(v.id || 'sem-venda') + ':nao-alocado', codigoMotivo:'nao-alocado',
          motivo:'Recebimento sem distribuição confirmada entre parcelas; não atribuído a um mês de vencimento.'});
      }
      for (const [i, p] of carne.entries()) {
        if (!p) continue;
        const fonte = Array.isArray(v.parcelas) && Number.isInteger(p.n) && p.n > 0 ? v.parcelas[p.n - 1] : null;
        if ([p, fonte].some(x => x && (x.apagadoEm || x.cancelado || x._remover))) continue;
        const l = linha(v, p, i, r.semEspelho ? 'plano' : 'espelho');
        if (r.semEspelho) {
          // O carnê derivado pode conter um plano reajustado e alocações
          // estimadas. Nenhuma delas é promovida a título/recebido confirmado.
          const saldo = numero(p.saldo), nominal = numero(p.valor), pago = numero(p.pago);
          l.previsto = reais(saldo ?? (nominal != null && pago != null ? Math.max(0, nominal - pago) : nominal ?? 0));
          l.motivo = 'Plano do contrato sem espelho de parcelas; não incluído no gráfico confirmado.';
          l.codigoMotivo = dataValida(l.venc) ? 'sem-espelho' : 'plano-sem-data';
          planos.push(l); continue;
        }
        candidatos.push({l, p, fonte});
      }
      // Entradas já presentes no carnê não são adicionadas novamente.
      if (!r.semEspelho && r.espelhoOmie && !v.entradaNoEspelho && v.entrada != null && v.entrada !== '') {
        const valor = numero(v.entrada), saldo = numero(r.entradaSaldo);
        if (valor !== 0) {
          const l = linha(v, {n:0, rotulo:'Entrada', venc:v.dataEntrada || v.dataVenda || '', valor:v.entrada, saldo:r.entradaSaldo}, 'entrada', 'entrada');
          l.id = String(v.id || 'sem-venda') + ':entrada';
          if (valor == null || saldo == null || saldo > valor) pendente(l, 'entrada-inconclusiva', 'Valor ou saldo da entrada sem confirmação consistente.');
          else if (!v.id) pendente(l, 'sem-venda', 'Contrato sem identidade confirmada.');
          else if (!dataValida(l.venc)) pendente(l, 'sem-data', 'Entrada sem vencimento válido.');
          else { l.recebido = reais(valor - saldo); l.aberto = reais(saldo); itens.push(l); }
        }
      }
      // O excesso pago na entrada não é uma parcela adicional nem reduz a
      // próxima parcela. O resumo já separa esse crédito dos não alocados.
      if (!r.semEspelho && numero(r.sobra) != null) {
        const excessoParcelas = carne.reduce((n, p) => n + (numero(p?.credito) || 0), 0);
        const excessoEntrada = Math.max(0, numero(r.sobra) - (numero(r.naoAlocado) || 0) - excessoParcelas);
        if (excessoEntrada) {
          const l = linha(v, {rotulo:'Crédito da entrada', venc:v.dataEntrada || v.dataVenda || '', valor:reais(excessoEntrada)}, 'credito-entrada', 'entrada');
          creditos.push({...l, id:String(v.id || 'sem-venda') + ':credito-entrada', codigoMotivo:'credito',
            motivo:'Valor excedente da entrada; separado da carteira e não aplicado automaticamente a outra parcela.'});
        }
      }
    }
    const ocorrencias = new Map();
    for (const {l} of candidatos) if (l.tid) ocorrencias.set(l.tid, (ocorrencias.get(l.tid) || 0) + 1);
    for (const {l, p} of candidatos) {
      if (l.tid && ocorrencias.get(l.tid) > 1) { pendente(l, 'titulo-duplicado', 'Título aparece em mais de uma parcela ou contrato; conferir o vínculo antes de somar.'); continue; }
      if (!l.vendaId) { pendente(l, 'sem-venda', 'Contrato sem identidade confirmada.'); continue; }
      if (p.conferir || p.situacao === 'conferir') { pendente(l, 'conferir', 'Parcela com conferência pendente no contrato; consulte a ficha e a conciliação.'); continue; }
      if (!dataValida(l.venc)) { pendente(l, 'sem-data', 'Parcela sem vencimento válido.'); continue; }
      const pago = numero(p.pago), saldo = numero(p.saldo), credito = p.credito == null ? 0 : numero(p.credito);
      if (pago == null || saldo == null || credito == null || credito > pago) {
        pendente(l, 'valores-inconclusivos', 'Recebido, saldo ou crédito da parcela sem confirmação consistente.'); continue;
      }
      l.recebido = reais(pago - credito); l.aberto = reais(saldo); l.credito = reais(credito); itens.push(l);
      if (credito) creditos.push({...l, id:l.id + ':credito', recebido:0, aberto:0, credito:0,
        valorReferencia:reais(credito), codigoMotivo:'credito', motivo:'Excedente recebido nesta parcela; separado da carteira e não aplicado automaticamente a outra parcela.'});
    }
    itens.sort((a, b) => a.venc.localeCompare(b.venc) || a.id.localeCompare(b.id));
    const meses = [], porMes = new Map(), de = itens[0]?.venc.slice(0, 7) || '', ate = itens.at(-1)?.venc.slice(0, 7) || '';
    if (de) {
      let ano = Number(de.slice(0, 4)), mes = Number(de.slice(5, 7));
      const ultimoAno = Number(ate.slice(0, 4)), ultimoMes = Number(ate.slice(5, 7));
      while (ano < ultimoAno || ano === ultimoAno && mes <= ultimoMes) {
        const chave = String(ano).padStart(4, '0') + '-' + String(mes).padStart(2, '0');
        const m = {chave, recebido:0, aberto:0, total:0, itens:[], atual:hoje.slice(0, 7) === chave};
        meses.push(m); porMes.set(chave, m); if (++mes > 12) { mes = 1; ano++; }
      }
    }
    for (const l of itens) porMes.get(l.venc.slice(0, 7)).itens.push(l);
    for (const m of meses) { m.recebido = soma(m.itens, 'recebido'); m.aberto = soma(m.itens, 'aberto'); m.total = reais(numero(m.recebido) + numero(m.aberto)); }
    const porAno = new Map();
    for (const m of meses) { const ano = m.chave.slice(0, 4); if (!porAno.has(ano)) porAno.set(ano, {ano, meses:[], recebido:0, aberto:0, total:0, itens:[]}); const a = porAno.get(ano); a.meses.push(m); a.itens.push(...m.itens); }
    const anos = [...porAno.values()];
    for (const a of anos) { a.recebido = soma(a.itens, 'recebido'); a.aberto = soma(a.itens, 'aberto'); a.total = reais(numero(a.recebido) + numero(a.aberto)); }
    const recebido = soma(itens, 'recebido'), aberto = soma(itens, 'aberto');
    return {anos, meses, itens, pendencias, planos, intervalo:{de, ate}, maximo:Math.max(0, ...meses.map(m => m.total)),
      naoAlocado, creditos,
      totais:{recebido, aberto, total:reais(numero(recebido) + numero(aberto)), previsto:soma(planos, 'previsto'), credito:soma(creditos, 'valorReferencia'),
        naoAlocado:soma(naoAlocado, 'valorReferencia'), parcelas:itens.length, contratos:idsVendas.size, pendencias:pendencias.length, planos:planos.length}};
  }
  return {montar};
})();
if (typeof module !== 'undefined') module.exports = FIN_PREVISAO_VENDAS;
