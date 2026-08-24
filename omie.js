// omie.js — a ponte da tela com o ERP Omie (o trabalho pesado é da função
// bsq-omie, no servidor; aqui é só disparar, mostrar e vincular).
//
// O que vem de lá: baixa de boleto vira recebimento, conta paga vira despesa
// com categoria, cadastro do Omie completa o do cliente, e a linha digitável
// do boleto aparece na cobrança. O que NUNCA entra sozinho: lançamento
// duvidoso — vira pendência listada nas Configurações.

const K_OMIE_VISTO = 'bsq_omie_visto';

const apiOmie = (action, dados = {}, opts = {}) =>
  api(action, dados, Object.assign({ url: API_OMIE, prazoMs: 280000 }, opts));

// Sincroniza em rodadas (o servidor pagina para caber no tempo dele).
// Devolve a última resposta, com as contagens somadas de todas as rodadas.
async function sincronizarOmie(aoVivo) {
  let pagina = null, parcial = null, resp = null;
  for (let volta = 0; volta < 25; volta++) {
    resp = await apiOmie('sincronizar', pagina ? { pagina, parcial } : {});
    if (!resp.ok) throw new Error(resp.error || 'o Omie não respondeu');
    parcial = resp.contagens || parcial;
    if (!resp.continua) break;
    pagina = resp.continua;
    if (aoVivo) toast('Omie: sincronizando… (parte ' + Math.ceil(pagina / 15) + ')');
  }
  localStorage.setItem(K_OMIE_VISTO, String(Date.now()));
  puxar();                                   // traz para a tela o que a função gravou
  return resp;
}

// Texto curto e humano do que a rodada fez.
function resumoOmie(c) {
  if (!c) return 'nada novo';
  const p = [];
  if (c.recNovos) p.push(c.recNovos + ' recebimento(s) baixado(s)');
  if (c.recParaConferir) p.push(c.recParaConferir + ' recebimento(s) para conferir');
  if (c.recEstornados) p.push(c.recEstornados + ' estorno(s)');
  if (c.cxNovos) p.push(c.cxNovos + ' despesa(s) nova(s)');
  if (c.cxDuvidosos) p.push(c.cxDuvidosos + ' pendência(s) para conferir');
  if (c.clientesCompletados) p.push(c.clientesCompletados + ' cadastro(s) completado(s)');
  return p.length ? p.join(', ') : 'nada novo';
}

// Ninguém precisa lembrar de sincronizar: quem entra (direção/escritório)
// dispara sozinho quando a última rodada tem mais de 20 horas.
async function talvezSincronizarOmie() {
  if (!['direcao', 'escritorio'].includes(S.perfil)) return;
  const visto = Number(localStorage.getItem(K_OMIE_VISTO) || 0);
  if (Date.now() - visto < 6 * 3600e3) return;     // conferido há pouco
  try {
    const r = await apiOmie('saude');
    const quando = r.sync && r.sync.quando ? new Date(r.sync.quando).getTime() : 0;
    if (Date.now() - quando < 20 * 3600e3) {
      localStorage.setItem(K_OMIE_VISTO, String(Date.now()));
      return;
    }
    const fim = await sincronizarOmie(false);
    const resumo = resumoOmie(fim && fim.contagens);
    if (resumo !== 'nada novo') toast('Omie sincronizado: ' + resumo);
  } catch (e) { /* silêncio aqui; o indicador das Configurações conta a verdade */ }
}

/* ── boletos do cliente, consultados na hora ───────────────────────────────── */
async function abrirBoletosVenda(v) {
  toast('Consultando os boletos no Omie…');
  let r;
  try { r = await apiOmie('boleto', { cpf: v.clienteId }); }
  catch (e) { toast(e.message || 'O Omie não respondeu', 'ruim'); return; }
  const ts = (r && r.titulos) || [];
  if (!ts.length) { toast((r && r.aviso) || 'Nenhum boleto em aberto no Omie para este cliente'); return; }
  const tel = typeof telDaVenda === 'function' ? telDaVenda(v) : '';
  const corpo =
    '<p class="nota">O que está em aberto no Omie para ' + esc(v.clienteNome || 'o cliente') +
      '. A linha digitável paga em qualquer banco.</p>' +
    ts.map((t, i) =>
      '<div class="lin" style="cursor:default"><div class="cresce"><b>vence ' + fmt.data(t.venc) + ' · ' + fmt.brl(t.aberto || t.valor) + '</b>' +
      '<span class="sub">' + esc(t.status || '') + (t.parcela ? ' · parcela ' + esc(t.parcela) : '') +
        (t.boleto ? ' · boleto ' + esc(t.boleto) : '') + '</span>' +
      (t.linhaDigitavel ? '<span class="sub" style="user-select:all;word-break:break-all">' + esc(t.linhaDigitavel) + '</span>' : '') +
      '</div>' +
      (t.linhaDigitavel ? '<button class="btn mini bo-copiar" data-i="' + i + '">copiar</button>' : '') +
      (tel && t.linhaDigitavel
        ? '<a class="btn mini whats" target="_blank" rel="noopener" href="' +
          esc(linkWhats(tel, 'Olá, ' + ((v.clienteNome || '').split(' ')[0] || '') +
            '! Segue a linha digitável do boleto que vence em ' + fmt.data(t.venc) + ' (' + fmt.brl(t.aberto || t.valor) + '):\n' +
            t.linhaDigitavel + '\nQualquer dúvida é só chamar. — Portal dos Bosques')) + '">📱</a>'
        : '') +
      '</div>').join('');
  abrirModal({
    titulo: '📄 Boletos em aberto — ' + (v.codigo || ''),
    corpo,
    acoes: [{ texto: 'Fechar', aoClicar: () => fecharModal() }],
  });
  document.querySelectorAll('.bo-copiar').forEach((b) => {
    b.onclick = () => {
      const t = ts[Number(b.dataset.i)];
      navigator.clipboard.writeText(t.linhaDigitavel).then(
        () => toast('Linha digitável copiada'),
        () => toast('Não deu para copiar — selecione o número e copie', 'ruim'));
    };
  });
}

/* ── recebimentos que chegaram sem venda: o vínculo é um clique ────────────── */
function vincularRecsOmie(aoTerminar) {
  const soltos = lista('rec').filter((r) => !r.vendaId);
  if (!soltos.length) { toast('Nenhum recebimento para vincular'); if (aoTerminar) aoTerminar(); return; }
  const vendas = lista('venda').filter((v) => v.situacao !== 'distratada');
  const rotulo = (v) => (v.codigo || '') + ' Q' + v.quadra + '-L' + v.lote + ' · ' + (v.clienteNome || '');
  const corpo =
    '<p class="nota">Dinheiro que entrou por boleto mas cujo CPF não bate com nenhuma venda — ou bate ' +
      'com mais de uma. Escolha a venda certa; o carnê aplica na parcela mais antiga em aberto. ' +
      'CPF sem venda nenhuma pode ser <b>venda que falta cadastrar</b>.</p>' +
    soltos.map((r) => {
      const cpf = (r.omie && r.omie.cpf) || '';
      const doCpf = cpf ? vendas.filter((v) => String(v.clienteId || '').replace(/\D/g, '') === cpf) : [];
      const opcoes = (doCpf.length ? doCpf : vendas).map((v) =>
        '<option value="' + esc(v.id) + '">' + esc(rotulo(v)) + '</option>').join('');
      return '<div class="lin" style="cursor:default;flex-wrap:wrap"><div class="cresce"><b>' +
        fmt.brl(r.valor) + ' · ' + fmt.data(r.data) + '</b>' +
        '<span class="sub">' + esc(r.obs || '') + (cpf ? ' · CPF ' + esc(cpf) : '') +
          (doCpf.length ? ' · ' + doCpf.length + ' venda(s) desse CPF' : ' · CPF sem venda no sistema') + '</span></div>' +
        '<select class="vr-venda" data-id="' + esc(r.id) + '"><option value="">— escolher a venda —</option>' + opcoes + '</select>' +
        '<button class="btn mini vr-ok" data-id="' + esc(r.id) + '">vincular</button></div>';
    }).join('');
  abrirModal({
    titulo: '🔗 Recebimentos do Omie sem venda (' + soltos.length + ')',
    corpo,
    acoes: [{ texto: 'Fechar', aoClicar: (fundo) => { fecharSilencioso ? fecharSilencioso(fundo) : fecharModal(); if (aoTerminar) aoTerminar(); } }],
  });
  document.querySelectorAll('.vr-ok').forEach((b) => {
    b.onclick = () => {
      const sel = document.querySelector('.vr-venda[data-id="' + b.dataset.id + '"]');
      if (!sel || !sel.value) { toast('Escolha a venda primeiro', 'ruim'); return; }
      const r = achar('rec', b.dataset.id);
      if (!r) return;
      salvar('rec', Object.assign({}, r, { vendaId: sel.value, conferir: false }));
      b.textContent = '✓'; b.disabled = true; sel.disabled = true;
      toast('Vinculado — o carnê aplica sozinho');
    };
  });
}

/* ── saldo das contas, segundo o Omie ──────────────────────────────────────── */
const K_OMIE_SALDOS = 'bsq_omie_saldos';

// Cache local de 30 min: o painel do Caixa aparece na hora e atualiza quando
// a resposta fresca chega. Devolve { quando, contas, bancario } ou null.
async function saldoBancosOmie() {
  try {
    const guardado = JSON.parse(localStorage.getItem(K_OMIE_SALDOS) || 'null');
    if (guardado && Date.now() - new Date(guardado.quando).getTime() < 30 * 60e3) return guardado;
    const r = await apiOmie('saldos');
    if (!r.ok) throw new Error(r.error || '');
    const novo = { quando: r.quando, contas: r.contas || [], bancario: r.bancario };
    localStorage.setItem(K_OMIE_SALDOS, JSON.stringify(novo));
    return novo;
  } catch (e) {
    // Sem rede, o último visto ainda serve — velho e dito é melhor que nada.
    try { return JSON.parse(localStorage.getItem(K_OMIE_SALDOS) || 'null'); } catch { return null; }
  }
}

function abrirSaldosOmie(dados, caixaSistema) {
  const linhas = (dados.contas || []).map((c) =>
    '<div class="lin" style="cursor:default"><div class="cresce"><b>' + esc(c.nome) + '</b>' +
    '<span class="sub">' + (c.tipo === 'CX' ? 'caixinha (dinheiro em espécie)' : 'conta bancária') + '</span></div>' +
    '<span class="dinheiro" style="font-weight:700;color:' + ((c.saldo || 0) >= 0 ? 'var(--verde)' : 'var(--ruim)') + '">' +
      (c.saldo == null ? '—' : fmt.brl(c.saldo)) + '</span></div>').join('');
  abrirModal({
    titulo: '🏦 Saldos no Omie',
    corpo: linhas +
      '<p class="nota" style="margin-top:8px">Conferido ' + fmt.quando(dados.quando) + ', direto do extrato do Omie. ' +
      'O <b>Caixa do empreendimento</b> (' + fmt.brl(caixaSistema) + ') soma a vida inteira registrada no sistema — ' +
      'os dois não têm obrigação de bater no centavo (dinheiro que não passou pelo banco, história anterior ao Omie), ' +
      'mas diferença grande merece investigação.</p>',
    acoes: [{ texto: 'Fechar', aoClicar: () => fecharModal() }],
  });
}

/* ── Conferência: sistema × Omie, lado a lado ─────────────────────────────────
   O comparativo pesado: entradas e saídas mês a mês, recebido por cliente e o
   desenho de cada carnê × o contrato que está no Omie. O agregado do Omie vem
   da função (cache de 12h no servidor); o lado do sistema é calculado aqui. */
const K_OMIE_CONF = 'bsq_omie_conf';

async function conferenciaOmie(forcar) {
  let body = forcar ? { forcar: true } : {};
  let r = null;
  for (let volta = 0; volta < 15; volta++) {
    r = await apiOmie('conferencia', body, { prazoMs: 280000 });
    if (!r.ok) throw new Error(r.error || 'o Omie não respondeu');
    if (!r.continua) break;
    body = { pagina: r.continua, parcial: r.parcial };
    const el = document.getElementById('cf-omie-progresso');
    if (el) el.textContent = 'conferindo o Omie… (parte ' + Math.ceil(r.continua / 15) + ')';
  }
  const dados = { quando: r.quando, porMes: r.porMes, porCliente: r.porCliente, carnes: r.carnes };
  localStorage.setItem(K_OMIE_CONF, JSON.stringify(dados));
  return dados;
}

TELAS.conferencia = function () {
  const app = document.getElementById('app');
  let dados = null;
  try { dados = JSON.parse(localStorage.getItem(K_OMIE_CONF) || 'null'); } catch { dados = null; }

  const desenhar = (d) => {
    if (!d) {
      app.innerHTML = '<div class="cartao"><h2>🔁 Conferência sistema × Omie</h2>' +
        '<p class="nota" id="cf-omie-progresso">buscando o retrato do Omie — a primeira vez varre tudo e demora uns minutos…</p></div>';
      return;
    }
    const so = (x) => String(x || '').replace(/\D/g, '');

    // ── lado do sistema ──────────────────────────────────────────────────────
    const sisMes = {};   // mes → {e, s}
    const marca = (mes, campo, v) => {
      if (!/^\d{4}-\d{2}$/.test(mes)) return;
      if (!sisMes[mes]) sisMes[mes] = { e: 0, s: 0 };
      sisMes[mes][campo] += v;
    };
    const DESDE = '2026-03';   // quando o Omie começou
    const sisCli = {};
    const vendasPorCpf = {};
    for (const v of lista('venda')) {
      const cpf = so(v.clienteId);
      (vendasPorCpf[cpf] = vendasPorCpf[cpf] || []).push(v);
    }
    for (const r of lista('rec')) {
      marca(mesDe(r.data), 'e', Number(r.valor) || 0);
      const v = achar('venda', r.vendaId);
      if (v && (r.data || '') >= DESDE + '-01') {
        const cpf = so(v.clienteId);
        sisCli[cpf] = (sisCli[cpf] || 0) + (Number(r.valor) || 0);
      }
    }
    for (const c of lista('cx')) {
      marca(mesDe(c.data), c.tipo === 'entrada' ? 'e' : 's', Number(c.valor) || 0);
      if (c.tipo === 'entrada' && c.vendaId && (c.data || '') >= DESDE + '-01') {
        const v = achar('venda', c.vendaId);
        if (v) { const cpf = so(v.clienteId); sisCli[cpf] = (sisCli[cpf] || 0) + (Number(c.valor) || 0); }
      }
    }

    // ── mês a mês ────────────────────────────────────────────────────────────
    const meses = [...new Set([...Object.keys(d.porMes || {}), ...Object.keys(sisMes).filter((m) => m >= DESDE)])].sort();
    const linhaMes = (mes, sis, om) => {
      const dif = Math.round((om - sis) * 100) / 100;
      const cor = Math.abs(dif) < 1 ? 'var(--tinta-fraca)' : dif > 0 ? 'var(--ruim)' : 'var(--verde)';
      return '<tr><td>' + nomeMes(mes) + '</td><td class="num">' + fmt.brl(sis) + '</td>' +
        '<td class="num">' + fmt.brl(om) + '</td>' +
        '<td class="num" style="font-weight:700;color:' + cor + '">' + (dif > 0 ? '+' : '') + fmt.brl(dif) + '</td></tr>';
    };
    const tabelaMes = (rot, campo, omCampo) =>
      '<div class="cartao"><h2>' + rot + ' <span class="nota">— sistema × Omie, mês a mês</span></h2>' +
      '<div class="rolagem"><table class="tabela"><thead><tr><th>Mês</th><th class="num">Sistema</th><th class="num">Omie</th><th class="num">Diferença</th></tr></thead><tbody>' +
      meses.map((m) => linhaMes(m, (sisMes[m] || { e: 0, s: 0 })[campo], ((d.porMes || {})[m] || { cr: 0, cp: 0 })[omCampo])).join('') +
      (() => {
        const ts = meses.reduce((s, m) => s + (sisMes[m] || { e: 0, s: 0 })[campo], 0);
        const to = meses.reduce((s, m) => s + (((d.porMes || {})[m] || { cr: 0, cp: 0 })[omCampo]), 0);
        return '<tr style="border-top:2px solid var(--borda);font-weight:800"><td>TOTAL</td><td class="num">' + fmt.brl(ts) +
          '</td><td class="num">' + fmt.brl(to) + '</td><td class="num">' + (to - ts > 0 ? '+' : '') + fmt.brl(Math.round((to - ts) * 100) / 100) + '</td></tr>';
      })() + '</tbody></table></div>' +
      '<p class="nota">Diferença <b style="color:var(--ruim)">vermelha</b>: o Omie viu dinheiro que o sistema não tem (falta registrar aqui). ' +
      '<b style="color:var(--verde)">Verde</b>: o sistema tem além do Omie (dinheiro fora do banco — PIX direto, espécie — ou registro dobrado).</p></div>';

    // ── por cliente ──────────────────────────────────────────────────────────
    const cpfs = [...new Set([...Object.keys(d.porCliente || {}), ...Object.keys(sisCli)])];
    const divCli = cpfs.map((cpf) => {
      const sis = Math.round((sisCli[cpf] || 0) * 100) / 100;
      const om = (d.porCliente || {})[cpf] || 0;
      const vs = vendasPorCpf[cpf] || [];
      const nome = (vs[0] && vs[0].clienteNome) || (achar('cliente', cpf) || {}).nome || 'CPF ' + cpf;
      return { cpf, nome, sis, om, dif: Math.round((om - sis) * 100) / 100, vendas: vs };
    }).filter((x) => Math.abs(x.dif) > 1).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
    const blocoCli =
      '<div class="cartao"><h2>Recebido por cliente <span class="nota">— desde março, ' + divCli.length + ' divergência(s)</span></h2>' +
      (divCli.length ? '<div class="rolagem"><table class="tabela"><thead><tr><th>Cliente</th><th class="num">Sistema</th><th class="num">Omie</th><th class="num">Diferença</th></tr></thead><tbody>' +
        divCli.map((x) =>
          '<tr class="cfc-lin" data-venda="' + esc(x.vendas.length === 1 ? x.vendas[0].id : '') + '" style="cursor:' + (x.vendas.length ? 'pointer' : 'default') + '">' +
          '<td><b>' + esc(x.nome) + '</b>' + (x.vendas.length ? ' <span class="nota">' + x.vendas.map((v) => v.codigo).join(' ') + '</span>' : ' <span class="nota">sem venda no sistema!</span>') + '</td>' +
          '<td class="num">' + fmt.brl(x.sis) + '</td><td class="num">' + fmt.brl(x.om) + '</td>' +
          '<td class="num" style="font-weight:700;color:' + (x.dif > 0 ? 'var(--ruim)' : 'var(--verde)') + '">' + (x.dif > 0 ? '+' : '') + fmt.brl(x.dif) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="nota">Tudo batendo, centavo a centavo.</p>') + '</div>';

    // ── carnê × contrato ─────────────────────────────────────────────────────
    const modal = (obj) => {
      let melhor = null, n = -1;
      for (const [k, v] of Object.entries(obj || {})) if (v > n) { n = v; melhor = k; }
      return melhor;
    };
    // As regras da casa, aprendidas na auditoria: o boleto sai pelo valor CHEIO
    // e tem ~20% de desconto até o vencimento (o sistema guarda o valor COM
    // desconto); cliente com vários lotes pode ter séries separadas OU um
    // boleto somado. Divergência de verdade é a venda que não casa com NADA.
    const perto = (a2, b2) => Math.abs(a2 - b2) <= Math.max(0.02, b2 * 0.015);
    const casaSerie = (parcela, tipo, alvo) => {
      const reaj2 = cfgReajuste();
      for (let deg = 0; deg <= 14; deg++) {
        const v = parcela * Math.pow(1 + (reaj2.pct || 6) / 100, deg);
        if (perto(v, alvo) || perto(v, alvo * 0.8)) return true;
        if (tipo !== 'Reajustada') break;
      }
      return false;
    };
    const divCarne = [];
    for (const [cpf, om] of Object.entries(d.carnes || {})) {
      const vs = (vendasPorCpf[cpf] || []).filter((v) => ['ativa', 'conferir'].includes(v.situacao || 'ativa'));
      if (!vs.length) continue;
      const series = Object.entries(om.valores || {}).filter(([, n]) => n >= 3).map(([v]) => Number(v));
      const somaCliente = vs.reduce((s2, v) => s2 + (Number(v.valorParcela) || 0), 0);
      const probs = [];
      if (series.length) {
        for (const v of vs) {
          const p2 = Number(v.valorParcela) || 0;
          const casa = series.some((s2) => casaSerie(p2, v.tipoParcela, s2)) ||
            series.some((s2) => casaSerie(somaCliente, 'Fixa', s2));
          if (!casa) probs.push(v.codigo + ': parcela ' + fmt.brl(p2) + ' não casa com o boleto (' +
            series.map((s2) => fmt.brl(s2) + ' cheio / ' + fmt.brl(s2 * 0.8) + ' c/ desconto').join(' · ') + ')');
        }
      }
      const fut = [];
      for (const v of vs) for (const l of CARNE.gerarParcelas(v, cfgReajuste())) {
        if (l.n > 0 && l.venc >= hojeISO()) fut.push(l);
      }
      const diaSis = modal(fut.reduce((o, l) => { const k = l.venc.slice(8, 10); o[k] = (o[k] || 0) + 1; return o; }, {}));
      const diaOm = modal(om.dias);
      if (diaOm && diaSis !== diaOm) probs.push('vence dia ' + diaSis + ' aqui, dia ' + diaOm + ' no Omie');
      if (vs.length === 1 && series.length === 1 && Math.abs(fut.length - om.futuros) > 2) {
        probs.push('faltam ' + fut.length + ' parcelas aqui, ' + om.futuros + ' lá');
      }
      if (probs.length) divCarne.push({ nome: vs[0].clienteNome || '', vendas: vs, probs });
    }
    const blocoCarne =
      '<div class="cartao"><h2>Carnê × contrato no Omie <span class="nota">— ' + divCarne.length + ' venda(s) com o desenho diferente</span></h2>' +
      (divCarne.length ? '<p class="nota">O boleto sai pelo valor cheio e tem ~20% de desconto até o vencimento — o sistema guarda o valor com desconto, ' +
        'e isso NÃO conta como divergência. O que aparece aqui é o que nem com essa regra fecha.</p>' +
        divCarne.map((x) =>
          '<div class="lin cfc-lin" data-venda="' + esc(x.vendas.length === 1 ? x.vendas[0].id : '') + '">' +
          '<div class="cresce"><b>' + esc(x.nome) + '</b> <span class="nota">' + x.vendas.map((v) => v.codigo).join(' ') + '</span>' +
          '<span class="sub">' + x.probs.map(esc).join(' · ') + '</span></div><span class="nota">abrir →</span></div>').join('')
        : '<p class="nota">Todos os carnês batem com os contratos do Omie.</p>') + '</div>';

    app.innerHTML =
      '<div class="cartao"><h2>🔁 Conferência sistema × Omie</h2>' +
      '<p class="nota">Conferido ' + fmt.quando(d.quando) + ' · <b>sistema</b> = planilha importada + lançamentos daqui · ' +
      '<b>Omie</b> = o que de fato passou pelos boletos e contas. ' +
      '<a href="#" id="cf-omie-atualizar">atualizar agora</a> <span id="cf-omie-progresso"></span></p></div>' +
      tabelaMes('↑ Entradas', 'e', 'cr') + tabelaMes('↓ Saídas', 's', 'cp') + blocoCli + blocoCarne;

    const at = document.getElementById('cf-omie-atualizar');
    if (at) at.onclick = async (ev) => {
      ev.preventDefault();
      at.textContent = 'atualizando…';
      try { desenhar(await conferenciaOmie(true)); } catch (e) { toast(e.message || 'Não deu agora', 'ruim'); }
    };
    app.querySelectorAll('.cfc-lin').forEach((el) => {
      el.onclick = () => { if (el.dataset.venda) location.hash = '#/venda/' + el.dataset.venda; };
    });
  };

  desenhar(dados);
  // Busca (ou renova) em segundo plano e redesenha por cima.
  conferenciaOmie(false).then((d) => { if (location.hash.includes('conferencia')) desenhar(d); })
    .catch(() => { if (!dados) desenhar(null); });
};
