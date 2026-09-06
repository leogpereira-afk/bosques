/* Núcleo financeiro: valores em centavos, pagamentos e alocações explícitas.
 * Funções puras; nenhuma escrita, rede ou inferência de recebimento. */
const FINANCEIRO = (() => {
  const cent = x => Math.round((Number(x) || 0) * 100);
  const rs = x => x / 100;
  const dataValida = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') &&
    !Number.isNaN(Date.parse(x + 'T12:00:00Z')) && new Date(x + 'T12:00:00Z').toISOString().slice(0,10) === x;
  const chave = (p, i) => String(p.tid || p.id || ('legado-' + i));
  function resumo(v, recs, hoje) {
    const ps = (v.parcelas || []).map((p,indiceOriginal)=>p?{...p,indiceOriginal}:null).filter(p => p && !p._remover && !p.cancelado);
    const pagamentos = recs.filter(r => !r.apagadoEm && r.vendaId === v.id);
    let naoAlocado = 0;
    const erros = [], porTitulo = new Map(), entradas = [];
    for (const r of pagamentos) {
      const valor = cent(r.valor);
      if (valor <= 0) { erros.push('Recebimento sem valor positivo: ' + r.id); continue; }
      if (r.tipo === 'entrada') { entradas.push(r); continue; }
      let als = r.alocacoes;
      if (!Array.isArray(als) && r.omie && r.omie.titulo) als = [{ tid: String(r.omie.titulo), valor: r.valor }];
      if (!Array.isArray(als)) { naoAlocado += valor; continue; }
      const soma = als.reduce((s,a) => s + cent(a.valor), 0);
      if (soma > valor || als.some(a => cent(a.valor) <= 0)) {
        erros.push('Alocação inválida: ' + r.id); naoAlocado += valor; continue;
      }
      let usado = 0;
      for (const a of als) {
        const tid = String(a.tid);
        if (!ps.some((p,i) => chave(p,p.indiceOriginal) === tid)) { erros.push('Parcela não encontrada: ' + tid); continue; }
        const itens = porTitulo.get(tid) || [];
        itens.push({ valor: cent(a.valor), data: r.data, id: r.id }); porTitulo.set(tid, itens); usado += cent(a.valor);
      }
      naoAlocado += valor - usado;
    }
    const carne = ps.map((p,i) => {
      const tid = chave(p,p.indiceOriginal), eventos = porTitulo.get(tid) || [];
      const valor = cent(p.valor), valorDia = p.valorDia == null ? valor : cent(p.valorDia);
      const valido = dataValida(p.venc), pendente = !!p.conferir || !valido || valor <= 0;
      const pago = eventos.reduce((s,e) => s + e.valor,0);
      const atePrazo = eventos.filter(e => dataValida(e.data) && e.data <= p.venc).reduce((s,e) => s + e.valor,0);
      const descontoAplicavel = p.descontoConfirmado === true;
      const desconto = descontoAplicavel && valido && (hoje <= p.venc || atePrazo >= valorDia);
      const acrescimos=cent(p.liquidacao?.juros)+cent(p.liquidacao?.multa);
      const descontoReal=cent(p.liquidacao?.desconto);
      const abatimento=descontoReal>0?descontoReal:(desconto?valor-valorDia:0);
      const devido = Math.max(0,valor+acrescimos-abatimento);
      const saldo = Math.max(0, devido - pago);
      const quitada = saldo === 0 && !pendente;
      const situacao = pendente ? 'conferir' : quitada ? 'paga' : p.venc < hoje ? 'atrasada' : pago > 0 ? 'parcial' : p.venc === hoje ? 'hoje' : 'aberta';
      return { n:p.indiceOriginal+1, tid, venc:p.venc || '', valor:rs(valor), valorDia:rs(descontoAplicavel ? valorDia : valor),
        pago:rs(pago), saldo:rs(saldo), desconto:rs(abatimento), acrescimos:rs(acrescimos), situacao,
        conferir:pendente, descontoPendente:p.valorDia != null && valorDia !== valor && !descontoAplicavel,
        pagoEm:quitada ? eventos.map(e=>e.data).sort().pop() || null : null,
        centroCusto:p.centroCusto||'', trava:!!p.trava, obs:p.obs || '', rotulo:(p.indiceOriginal+1)+'ª', origem:p.origem || '',
        credito:rs(Math.max(0,pago-devido)) };
    });
    const entrada = cent(v.entrada), entradaPaga = entradas.reduce((s,r)=>s+cent(r.valor),0);
    const entradaSaldo = Math.max(0,entrada-entradaPaga);
    const pago = pagamentos.reduce((s,r)=>s+cent(r.valor),0);
    const saldo = carne.reduce((s,l)=>s+cent(l.saldo),0)+entradaSaldo;
    const atraso = carne.filter(l=>l.situacao === 'atrasada');
    return { carne, total:rs(entrada+ps.reduce((s,p)=>s+cent(p.valor),0)), pago:rs(pago), saldo:rs(saldo),
      emAtraso:rs(atraso.reduce((s,l)=>s+cent(l.saldo),0)), qtdAtraso:atraso.length,
      saldoPendente:rs(carne.filter(l=>l.conferir).reduce((s,l)=>s+cent(l.saldo),0)), entradaSaldo:rs(entradaSaldo), naoAlocado:rs(naoAlocado),
      desconto:rs(carne.reduce((s,l)=>s+cent(l.desconto),0)),
      sobra:rs(naoAlocado+Math.max(0,entradaPaga-entrada)+carne.reduce((s,l)=>s+cent(l.credito),0)),
      pendencias:erros, qtdConferir:carne.filter(l=>l.conferir).length,
      quitada:carne.length>0 && saldo===0 && !carne.some(l=>l.conferir) && !erros.length && naoAlocado===0,
      proxima:carne.filter(l=>['aberta','hoje','parcial'].includes(l.situacao)).sort((a,b)=>a.venc.localeCompare(b.venc)||a.tid.localeCompare(b.tid))[0] || null,
      espelhoOmie:true };
  }
  function alocar(v, recs, valor, hoje, tid) {
    let resto=cent(valor); const out=[];
    const r=resumo(v,recs,hoje);
    const candidatas=r.carne.filter(p=>!p.conferir && p.saldo>0 && (!tid || String(p.tid)===String(tid)))
      .sort((a,b)=>a.venc.localeCompare(b.venc)||String(a.tid).localeCompare(String(b.tid)));
    for(const p of candidatas) { const parcela=Math.min(resto,cent(p.saldo));
      if(parcela>0) out.push({tid:p.tid,valor:rs(parcela)}); resto-=parcela; }
    return out;
  }
  return {cent,rs,dataValida,chave,resumo,alocar};
})();
if (typeof module !== 'undefined') module.exports = FINANCEIRO;
