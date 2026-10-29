/* Núcleo financeiro: valores em centavos, pagamentos e alocações explícitas.
 * Funções puras; nenhuma escrita, rede ou inferência de recebimento. */
const FINANCEIRO = (() => {
  const cent = x => Math.round((Number(x) || 0) * 100);
  const rs = x => x / 100;
  const dataValida = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') &&
    !Number.isNaN(Date.parse(x + 'T12:00:00Z')) && new Date(x + 'T12:00:00Z').toISOString().slice(0,10) === x;
  const chave = (p, i) => String(p.tid || p.id || ('legado-' + i));
  const tituloDisponivel = t => !!t && !t.apagadoEm && !t.ausenteOrigemOmie && !t.cancelado && t.status !== 'CANCELADO';
  const vendaAtiva = v => !!v && !v.apagadoEm && ['ativa', 'conferir', 'quitada'].includes(v.situacao || 'ativa');
  function identidadeConta(id, contas = []) {
    const identidade = String(id ?? '');
    if (!identidade || contas.some(c => String(c?.omieId ?? '') === identidade)) return identidade;
    const conta = contas.find(c => String(c?.id ?? '') === identidade);
    return conta?.omieId == null || conta.omieId === '' ? identidade : String(conta.omieId);
  }
  function classificarVinculos(vinculos = []) {
    const vivos = vinculos.filter(x => vendaAtiva(x?.venda) && x.parcela &&
      !x.parcela.apagadoEm && !x.parcela.cancelado && !x.parcela._remover);
    const vinculo = vivos.length === 1 ? vivos[0] : null;
    const valoresPendentes = !!(vinculo?.parcela.conferir && vinculo.parcela.vinculoConfirmado === true);
    const situacao = !vivos.length ? 'semvinculo' : vivos.length > 1 ? 'multiplo' :
      valoresPendentes ? 'valorespendentes' : vinculo.parcela.conferir ? 'incerto' : 'confirmado';
    return { situacao, confirmado: situacao === 'confirmado' || valoresPendentes, valoresPendentes, vinculo };
  }
  // O corte limita a importação do caixa, não apaga a prova do título. Esta
  // apuração não grava recebimentos: só devolve eventos para o cálculo da ficha
  // e motivos de conferência. Recebimentos devem incluir também a lixeira.
  function indiceHistoricoAntesCorte({titulos = [], recebimentos = []} = {}) {
    const porTitulo = new Map(), recebimentosPorTitulo = new Map(), recebimentosSemAlocacaoPorVenda = new Map();
    const incluir = (mapa, chave, valor) => {
      const itens = mapa.get(chave) || [];
      itens.push(valor); mapa.set(chave, itens);
    };
    for (const t of new Set(titulos)) if (t?.grupo === 'CONTA_A_RECEBER') incluir(porTitulo, String(t.titulo), t);
    // Um recibo pode citar vários títulos e ter a mesma relação no ID, no
    // objeto Omie e nas alocações. Preservar as relações sem repetir o objeto.
    for (const r of new Set(recebimentos)) {
      const tids = new Set();
      if (r.omie?.titulo) tids.add(String(r.omie.titulo));
      if (typeof r.id === 'string' && r.id.startsWith('rbomie-')) tids.add(r.id.slice(7));
      if (Array.isArray(r.alocacoes)) for (const a of r.alocacoes) tids.add(String(a.tid));
      for (const tid of tids) incluir(recebimentosPorTitulo, tid, r);
      if (r.tipo !== 'entrada' && !r.omie?.titulo && (!Array.isArray(r.alocacoes) || !r.alocacoes.length)) {
        incluir(recebimentosSemAlocacaoPorVenda, r.vendaId, r);
      }
    }
    return {porTitulo, recebimentosPorTitulo, recebimentosSemAlocacaoPorVenda};
  }
  function historicoAntesCorte(v, {titulos = [], recebimentos = [], corte = '', vinculos = new Map(), hoje = '', indice} = {}) {
    const pagamentos = [], conferencias = [], vistos = new Set();
    const doc = x => String(x || '').replace(/\D/g, '');
    const numero = x => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '')) && Number.isFinite(Number(x)) ? Number(x) : null;
    const opcional = x => x == null ? 0 : numero(x);
    const dataOrigem = x => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(x || ''));
      const iso = m ? m[3]+'-'+m[2]+'-'+m[1] : String(x || '');
      return dataValida(iso) ? iso : '';
    };
    const {porTitulo, recebimentosPorTitulo, recebimentosSemAlocacaoPorVenda} = indice || indiceHistoricoAntesCorte({titulos,recebimentos});
    for (const p of v.parcelas || []) {
      if (!p?.tid || p.apagadoEm || p.cancelado || p._remover || vistos.has(String(p.tid))) continue;
      const tid = String(p.tid); vistos.add(tid);
      const fontes = porTitulo.get(tid) || [], t = fontes[0], original = t?.original;
      const d = original?.detalhes || {}, s = original?.resumo || {}, data = dataOrigem(d.dDtPagamento);
      const indicio = numero(s.nValPago) > 0 || t?.status === 'RECEBIDO' || s.cLiquidado === 'S' ||
        (p.pagoOrigem === 'omie' && !!p.pago) || (dataValida(corte) && dataOrigem(p.pago) && dataOrigem(p.pago) < corte);
      if (!indicio || (data && dataValida(corte) && data >= corte)) continue;
      const valorOrigem = numero(s.nValLiquido);
      const pendente = motivo => conferencias.push({tid, motivo, corte, dataPagamento:data || '', valorOrigem});
      const relacionados = [...new Set([...(recebimentosPorTitulo.get(tid) || []),...(recebimentosSemAlocacaoPorVenda.get(v.id) || [])])];
      const rec = relacionados.length === 1 ? relacionados[0] : null;
      // A prova que já virou um recebimento Omie válido não vira outro evento.
      const representado = rec && !rec.apagadoEm && !rec.conferir && rec.origem === 'omie' && rec.vendaId === v.id &&
        String(rec.omie?.titulo || '') === tid && data && rec.data === data && valorOrigem > 0 && cent(rec.valor) === cent(valorOrigem) &&
        (rec.alocacoes == null || (Array.isArray(rec.alocacoes) && rec.alocacoes.length === 1 && String(rec.alocacoes[0].tid) === tid && cent(rec.alocacoes[0].valor) === cent(valorOrigem)));
      if (representado) continue;
      if (relacionados.length) { pendente('Recebimento existente, manual ou apagado: conferir o histórico sem duplicar o pagamento.'); continue; }
      if (!dataValida(corte) || !data) { pendente('Data do pagamento na origem ou corte de importação sem comprovação válida.'); continue; }
      if (dataValida(hoje) && data > hoje) { pendente('Data de pagamento futura na origem; conferir antes de reconhecer a liquidação.'); continue; }
      if (fontes.length !== 1 || !tituloDisponivel(t) || t.origem !== 'omie') { pendente('Título de origem ausente, indisponível ou sem identidade única.'); continue; }
      const vinculo = vinculos.get(tid);
      if (!v.id || vinculo?.situacao !== 'confirmado' || vinculo.vinculo?.venda.id !== v.id || !doc(v.clienteId) || doc(t.cpf) !== doc(v.clienteId)) {
        pendente('Identidade do título, cliente ou contrato ainda precisa de conferência.'); continue;
      }
      // O snapshot reduz detalhes, mas conserva estes campos no envelope. Se
      // houver também o original integral, ambos precisam concordar.
      if ((d.nCodTitulo != null && String(d.nCodTitulo) !== tid) || (d.cGrupo != null && d.cGrupo !== t.grupo) ||
        (d.cStatus != null && d.cStatus !== t.status) || (d.cCPFCNPJCliente != null && doc(d.cCPFCNPJCliente) !== doc(t.cpf)) ||
        (d.nValorTitulo != null && (numero(d.nValorTitulo) === null || cent(d.nValorTitulo) !== cent(t.valor))) ||
        (d.dDtVenc != null && dataOrigem(d.dDtVenc) !== t.venc)) {
        pendente('Campos da origem divergem da identidade ou dos valores do título.'); continue;
      }
      if (t.status !== 'RECEBIDO' || s.cLiquidado !== 'S' || numero(s.nValAberto) !== 0 || !(numero(s.nValPago) > 0)) {
        pendente('Pagamento parcial ou liquidação sem prova completa na origem.'); continue;
      }
      const nominal = numero(t.valor), desconto = opcional(s.nDesconto), juros = opcional(s.nJuros), multa = opcional(s.nMulta);
      if (!(nominal > 0) || !(valorOrigem > 0) || [desconto,juros,multa].some(n => n === null || n < 0) ||
        cent(s.nValPago) !== cent(nominal) || cent(nominal)-cent(desconto)+cent(juros)+cent(multa) !== cent(valorOrigem) ||
        cent(p.valor) !== cent(nominal) || !dataValida(t.venc) || p.venc !== t.venc ||
        cent(p.liquidacao?.desconto) !== cent(desconto) || cent(p.liquidacao?.juros) !== cent(juros) || cent(p.liquidacao?.multa) !== cent(multa)) {
        pendente('Valor, vencimento ou encargos locais divergem da liquidação comprovada na origem.'); continue;
      }
      const evento = {tid, data, valor:rs(cent(valorOrigem))};
      const calculo = resumo({id:v.id, parcelas:[p]}, [{vendaId:v.id, valor:evento.valor, data, alocacoes:[{tid,valor:evento.valor}]}], data);
      if (!calculo.quitada || calculo.sobra !== 0) { pendente('Condições locais da parcela exigem conferência do pagamento histórico.'); continue; }
      pagamentos.push(evento);
    }
    return {pagamentos, conferencias, corte};
  }
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
  return {cent,rs,dataValida,chave,tituloDisponivel,vendaAtiva,identidadeConta,classificarVinculos,indiceHistoricoAntesCorte,historicoAntesCorte,resumo,alocar};
})();
if (typeof module !== 'undefined') module.exports = FINANCEIRO;
