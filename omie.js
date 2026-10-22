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

// Planos ficam privados no servidor. Cada item exige a sessão pessoal da direção.
async function aplicarCorrecoesPreparadas(aoVivo) {
  const consulta=await apiOmie('sincronizar',{consultarCorrecoesAuditadas:true});
  if(!consulta.ok||!consulta.plano?.total)throw new Error(consulta.error||'Nenhum plano preparado para aplicar.');
  const plano=consulta.plano;
  for(let indice=0;indice<plano.total;indice++){
    const r=await apiOmie('sincronizar',{correcoesAuditadas:plano.chave,indice});
    if(!r.ok)throw new Error(r.error||'A conferência foi interrompida; os resultados anteriores foram preservados.');
    if(aoVivo)aoVivo({atual:indice+1,total:plano.total,situacao:r.situacao||'aguardando_conferencia'});
  }
  let inicioConferencia=0;
  for(let rodada=0;rodada<200;rodada++){
    const final=await apiOmie('sincronizar',{confirmarCorrecoesAuditadas:plano.chave,inicioConferencia});
    if(!final.ok)throw new Error(final.error||'Envios registrados; a confirmação da origem ainda está pendente.');
    if(final.continua==null)return final;
    inicioConferencia=final.continua;
    if(final.aguardando)await new Promise(resolve=>setTimeout(resolve,Math.min(60000,final.esperaMs||60000)));
  }
  throw new Error('Os envios foram preservados. Retome a conferência da origem.');
}

// Sincroniza em rodadas (o servidor pagina para caber no tempo dele).
// Devolve a última resposta, com as contagens somadas de todas as rodadas.
async function sincronizarOmie(aoVivo) {
  let pagina = null, parcial = null, resp = null, inicio = null;
  for (let volta = 0; volta < 25; volta++) {
    resp = await apiOmie('sincronizar', pagina ? { pagina, parcial, inicio } : {});
    if (!resp.ok) throw new Error(resp.error || 'o Omie não respondeu');
    parcial = resp.contagens || parcial; inicio = resp.inicio || inicio;
    if (!resp.continua) break;
    pagina = resp.continua;
    if (aoVivo) toast('Omie: sincronizando… (parte ' + Math.ceil(pagina / 15) + ')');
  }
  if (resp && resp.continua) { registrarSyncOmie(false, "Sincronização parcial: ainda há páginas pendentes"); throw new Error("Sincronização incompleta. Retome pela central financeira."); }
  localStorage.setItem(K_OMIE_VISTO, String(Date.now()));
  registrarSyncOmie(true, resumoOmie(resp && resp.contagens));
  await puxar();
  return resp;
}

// O registro que a tela de Início mostra: quando foi, deu certo, o que trouxe.
const K_OMIE_ULTIMA = 'bsq_omie_ultima';
function registrarSyncOmie(ok, detalhe) {
  try {
    localStorage.setItem(K_OMIE_ULTIMA, JSON.stringify({ em: new Date().toISOString(), ok, detalhe: String(detalhe || '') }));
  } catch (e) { /* sem espaço: o indicador cai no servidor */ }
}

// Home e Configurações usam a mesma saúde. Consultar não importa nem grava dados.
// A meta muda mesmo sem novos lançamentos: atualizamos só estes elementos,
// sem redesenhar a página ou apagar o que está sendo digitado no formulário.
const _alvosSaudeOmie = new Map();
const _htmlSaudeOmie = new WeakMap();
let _dadosSaudeOmie = null, _erroSaudeOmie = '', _sessaoSaudeOmie = '', _consultaSaudeOmie = null;
let _timerSaudeOmie = null, _vigiaGlobalOmie = false, _servidorForaOmie = false;

function pendenciasOmieHtml(pendencias, resumo) {
  const linhas = Array.isArray(pendencias) ? pendencias : [];
  const grupos = [
    { chave: 'vinculo', nome: 'vínculo com vendas', nota: 'Títulos importados do Omie que precisam ter o contrato confirmado.', itens: [] },
    { chave: 'possivel_duplicidade', nome: 'possível duplicidade', nota: 'Compare os registros antes de decidir se representam o mesmo pagamento.', itens: [] },
    { chave: 'outros', nome: 'outras conferências', nota: 'Confira as informações de origem e os ajustes já registrados no Financeiro.', itens: [] },
  ];
  for (const p of linhas) {
    if (!p || typeof p !== 'object') continue;
    grupos[p.tipo === 'vinculo' ? 0 : p.tipo === 'possivel_duplicidade' ? 1 : 2].itens.push(p);
  }
  // Servidores anteriores enviam a lista inteira; os novos enviam totais e exemplos.
  for (const g of grupos) g.total = Number.isInteger(resumo?.[g.chave]) && resumo[g.chave] >= g.itens.length ? resumo[g.chave] : g.itens.length;
  const ativos = grupos.filter(g => g.total), total = ativos.reduce((n, g) => n + g.total, 0);
  if (!total) return '';
  const limite = Math.floor(12 / ativos.length);
  return '<details class="omie-pendencias"><summary><b>' + total + ' registro(s) para conferir</b></summary>' +
    '<p>São conferências de vínculo ou conciliação. Verifique os registros existentes antes de criar qualquer lançamento.</p>' +
    ativos.map(g => '<p><b>' + g.total + ' · ' + g.nome + '</b><br>' + g.nota + '</p><ul>' +
      g.itens.slice(0, limite).map(p => '<li data-pendencia-omie>' +
        (p.titulo ? 'Título ' + esc(p.titulo) : 'Registro sem número de título') +
        (p.data ? ' · ' + esc(fmt.data(p.data)) : '') +
        (Number.isFinite(Number(p.valor)) ? ' · ' + esc(fmt.brl(Number(p.valor))) : '') + '</li>').join('') +
      '</ul>' + (g.total > Math.min(limite, g.itens.length) ? '<p>Mais ' + (g.total - Math.min(limite, g.itens.length)) + ' registro(s) neste grupo.</p>' : '')).join('') +
    '<p><a href="#/financeiro">Abrir Financeiro para conferir</a></p></details>';
}

// Vermelho quando a atualização PAROU (não só "atrasou"): falhas seguidas há
// 30 min ou mais, rodada sem avançar há 45 min, ou nenhuma conclusão há 3 h com
// o automático ligado. De 17/09 a 30/09 ela ficou parada e a tela só mostrava
// laranja no fim do Início.
const OMIE_PARADA_HORAS = 3, OMIE_SEM_AVANCO_MIN = 45;
function textoSaudeOmie(dados, erro, servidorFora) {
  const sync = dados?.sync, quando = sync?.quando, ex = dados?.execucao || null;
  const dataBR = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR') : ''; };
  // Idades pelo relógio do servidor (o do aparelho pode estar errado), mais o
  // tempo passado desde que a resposta chegou.
  const agoraServidor = Date.parse(dados?.agora || '');
  const agoraMs = Number.isFinite(agoraServidor) ? agoraServidor + Math.max(0, Date.now() - (dados._recebidoEm || Date.now())) : Date.now();
  const data = dataBR(quando);
  const ultima = data ? ' Última conclusão conhecida: ' + esc(data) + '.' : '';
  const automatico = dados?.automacao?.ativa === true;
  const horas = Number.isFinite(Date.parse(quando || '')) ? (agoraMs - Date.parse(quando)) / 3600e3 : Infinity;
  const parada = automatico && Number.isFinite(horas) && horas >= OMIE_PARADA_HORAS;
  const semConcluir = parada ? ' Sem concluir há ' + Math.floor(horas) + ' h.' : '';
  const avise = ' Avise quem cuida do sistema.';
  if (erro) {
    // Servidor fora (erro 5xx) e a última conclusão já antiga: vermelho. Sem
    // internet no aparelho fica laranja: o problema pode ser só a conexão.
    if (servidorFora && parada) return '🔴 Não foi possível consultar a situação da integração: ' + esc(erro) + '.' + ultima + semConcluir + avise;
    return '🟠 Não foi possível consultar a situação da integração agora. ' + esc(erro) + ultima +
      ' A consulta será tentada novamente; os dados salvos continuam disponíveis.';
  }
  if (!dados) return '🟠 Consultando a situação da integração Omie…';
  if (Number(ex?.tentativas) > 0 && Number.isFinite(Date.parse(ex.falhando_desde || ''))) {
    const minutos = (agoraMs - Date.parse(ex.falhando_desde)) / 60e3, proxima = dataBR(ex.proxima);
    const vermelho = minutos >= 30 || parada;
    return (vermelho ? '🔴' : '🟠') + ' Omie: a atualização está falhando desde ' + esc(dataBR(ex.falhando_desde)) +
      ' (' + Number(ex.tentativas) + ' tentativa(s) seguidas). ' + esc(ex.ultimo_erro || sync?.erro || 'Confira a integração.') +
      (proxima ? ' Próxima tentativa: ' + esc(proxima) + '.' : '') + ultima + semConcluir + (vermelho ? avise : '');
  }
  if (sync?.status === 'falhou') {
    // Servidor sem o estado da rodada (versão anterior): uma falha isolada fica
    // laranja nos primeiros 30 min, até a próxima tentativa.
    const recente = !ex && !parada && Number.isFinite(Date.parse(sync.termino || '')) && agoraMs - Date.parse(sync.termino) < 30 * 60e3;
    return (recente ? '🟠' : '🔴') + ' Omie: a última tentativa de atualização falhou. ' +
      esc(sync.erro || 'Confira a integração.') + ultima + semConcluir;
  }
  if (sync?.status === 'em_andamento' || (data && sync?.status && sync.status !== 'completa')) {
    // Rodada em andamento: vale o último AVANÇO (a próxima é marcada a cada lote
    // concluído), não a última conclusão. Uma releitura longa que continua
    // andando não está parada; uma que parou de andar, sim.
    let travada = parada, desde = '';
    if (ex) {
      const rodando = Date.parse(ex.reservado_ate || '') > agoraMs, avanco = Date.parse(ex.proxima || '');
      travada = !rodando && (Number.isFinite(avanco) ? (agoraMs - avanco) / 60e3 >= OMIE_SEM_AVANCO_MIN : parada);
      desde = travada && Number.isFinite(avanco) ? ' Sem avançar desde ' + esc(dataBR(ex.proxima)) + '.' : '';
    }
    return (travada ? '🔴' : '🟠') + ' Omie: ' + (ex?.completa ? 'releitura completa' : 'atualização') + ' em andamento no servidor' +
      (Number(ex?.pagina) > 1 ? ' (página ' + Number(ex.pagina) + ')' : '') + '.' +
      (travada ? (desde || semConcluir) + avise : '') + ultima;
  }
  if (!data) return '🟠 Omie: nenhuma sincronização concluída foi registrada. Confira a integração antes de atualizar os dados.';
  const emDia = horas < (automatico ? 0.75 : 26);
  const paradaConcluida = horas >= (automatico ? OMIE_PARADA_HORAS : 48);
  const desativado = dados.automacao?.ativa === false;
  return (emDia && !desativado ? '🟢' : paradaConcluida ? '🔴' : '🟠') + ' Omie: última conclusão ' + esc(data) +
    (emDia ? ' ✓' : paradaConcluida ? ', atualização PARADA há ' + Math.floor(horas) + ' h' : ' — atualização atrasada') +
    (automatico ? ' · automático a cada ' + esc(dados.automacao.intervaloMinutos || 15) + ' min, mesmo com o Portal fechado' :
      desativado ? ' · atualização automática desativada' : '') +
    ' — ' + esc(resumoOmie(sync.contagens));
}

function pintarSaudeOmie() {
  const texto = textoSaudeOmie(_dadosSaudeOmie, _erroSaudeOmie, _servidorForaOmie);
  // O selo do topo (app.js) mostra o vermelho em qualquer tela.
  const alerta = texto.startsWith('🔴') ? 'Omie parado' : '';
  if (S.omieAlerta !== alerta) { S.omieAlerta = alerta; if (typeof atualizarBadge === 'function') atualizarBadge(); }
  for (const [el, detalhar] of _alvosSaudeOmie) {
    if (!document.body.contains(el)) { _alvosSaudeOmie.delete(el); continue; }
    const html = texto +
      (detalhar && _dadosSaudeOmie ? pendenciasOmieHtml(_dadosSaudeOmie.sync?.pendencias, _dadosSaudeOmie.sync?.pendenciasResumo) : '');
    if (_htmlSaudeOmie.get(el) === html) continue;
    const aberto = el.querySelector('details')?.open;
    el.innerHTML = html; _htmlSaudeOmie.set(el, html);
    if (aberto && el.querySelector('details')) el.querySelector('details').open = true;
  }
}

async function atualizarSaudeOmie() {
  for (const el of _alvosSaudeOmie.keys()) if (!document.body.contains(el)) _alvosSaudeOmie.delete(el);
  // Sem sessão ou com perfil de corretor (pode mudar sem recarregar), nada de selo.
  if ((!S.senhaHash || S.perfil === 'corretor') && S.omieAlerta) { S.omieAlerta = ''; if (typeof atualizarBadge === 'function') atualizarBadge(); }
  if (document.hidden || (!_alvosSaudeOmie.size && !_vigiaGlobalOmie) || !S.senhaHash || S.perfil === 'corretor') return;
  const sessao = S.senhaHash;
  if (_sessaoSaudeOmie !== sessao) {
    _sessaoSaudeOmie = sessao; _dadosSaudeOmie = null; _erroSaudeOmie = '';
    pintarSaudeOmie();
  }
  if (_consultaSaudeOmie?.sessao === sessao) return _consultaSaudeOmie.promessa;
  const consulta = { sessao, promessa: null };
  _consultaSaudeOmie = consulta;
  consulta.promessa = (async () => {
    try {
      const r = await apiOmie('saude', { resumida: true }, { prazoMs: 20000 });
      if (!r || r.ok !== true) throw new Error('O servidor não confirmou a consulta.');
      if (S.senhaHash !== sessao) return;
      r._recebidoEm = Date.now();
      _dadosSaudeOmie = r; _erroSaudeOmie = ''; _servidorForaOmie = false;
      return r;
    } catch (e) {
      if (S.senhaHash !== sessao) return;
      _servidorForaOmie = Number(e.status) >= 500;
      _erroSaudeOmie = e.semSenha ? 'Sua sessão no painel precisa ser renovada.' :
        !navigator.onLine ? 'Este aparelho está sem conexão.' :
        e.rede || /fetch|network|load failed|abort/i.test(e.message || '') ? 'A conexão deste aparelho com o servidor não respondeu.' :
        String(e.message || 'Falha temporária de conexão.');
    } finally {
      if (_consultaSaudeOmie === consulta) _consultaSaudeOmie = null;
      if (S.senhaHash === sessao) pintarSaudeOmie();
    }
  })();
  return consulta.promessa;
}

function ligarRelogioSaudeOmie() {
  if (_timerSaudeOmie !== null) return;
  _timerSaudeOmie = setInterval(atualizarSaudeOmie, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarSaudeOmie(); });
  window.addEventListener('online', atualizarSaudeOmie);
}
function acompanharSaudeOmie(el, detalhar) {
  if (!el) return Promise.resolve();
  el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  _alvosSaudeOmie.set(el, detalhar);
  if (_sessaoSaudeOmie === S.senhaHash) pintarSaudeOmie();
  ligarRelogioSaudeOmie();
  return atualizarSaudeOmie();
}
// Direção e escritório acompanham a saúde em qualquer tela (selo do topo),
// não só quando o Início ou as Configurações estão abertos.
function vigiarSaudeOmie() {
  if (_vigiaGlobalOmie || !S.senhaHash || S.perfil === 'corretor') return;
  _vigiaGlobalOmie = true;
  ligarRelogioSaudeOmie();
  atualizarSaudeOmie();
}
function statusOmieHome(el) { return acompanharSaudeOmie(el, false); }
function statusOmieConfig(el) { return acompanharSaudeOmie(el, true); }

// Texto curto e humano do que a rodada fez.
function resumoOmie(c) {
  if (!c) return 'nada novo';
  const p = [];
  if (c.vendasNovas) p.push(c.vendasNovas + ' venda(s) nova(s)');
  if (c.clientesNovos) p.push(c.clientesNovos + ' cliente(s) novo(s)');
  if (c.pagamentosVinculados) p.push(c.pagamentosVinculados + ' pagamento(s) associado(s)');
  if (c.titulosVinculados) p.push(c.titulosVinculados + ' título(s) associado(s) aos lotes');
  if (c.recNovos) p.push(c.recNovos + ' recebimento(s) baixado(s)');
  if (c.recParaConferir) p.push(c.recParaConferir + ' recebimento(s) para conferir');
  if (c.recEstornados) p.push(c.recEstornados + ' estorno(s)');
  if (c.cxNovos) p.push(c.cxNovos + ' despesa(s) nova(s)');
  if (c.cxDuvidosos) p.push(c.cxDuvidosos + ' pendência(s) para conferir');
  if(c.recAtualizados) p.push(c.recAtualizados+' recebimento(s) atualizado(s)');
  if(c.cxAtualizados) p.push(c.cxAtualizados+' despesa(s) atualizada(s)');
  if(c.vendasEspelhadas) p.push(c.vendasEspelhadas+' venda(s) conferida(s)');
  if(c.cxAguardandoConciliacao) p.push(c.cxAguardandoConciliacao+' despesa(s) aguardando conciliação');
  if (c.clientesCompletados) p.push(c.clientesCompletados + ' cadastro(s) completado(s)');
  return p.length ? p.join(', ') : 'nenhum novo registro ou atualização informado';
}

// Ninguém precisa lembrar de sincronizar: quem entra (direção/escritório)
// dispara sozinho quando a última rodada tem mais de 20 horas.
async function talvezSincronizarOmie() {
  if (window.FINANCEIRO_EM_VALIDACAO) return;
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
  } catch (e) { registrarSyncOmie(false, e.message || 'sem resposta'); }
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
  const nomeDoCpf = (cpf) => {
    const c = cpf && achar('cliente', cpf);
    return c ? (c.nome || '') : '';
  };
  const corpo =
    '<p class="nota">Dinheiro que entrou por boleto mas cujo CPF não bate com nenhuma venda — ou bate ' +
      'com mais de uma. Escolha a venda certa; o carnê aplica na parcela mais antiga em aberto. ' +
      'CPF sem venda nenhuma pode ser <b>venda que falta cadastrar</b>.</p>' +
    soltos.map((r) => {
      const cpf = (r.omie && r.omie.cpf) || '';
      const doCpf = cpf ? vendas.filter((v) => String(v.clienteId || '').replace(/\D/g, '') === cpf) : [];
      const opcoes = (doCpf.length ? doCpf : vendas).map((v) =>
        '<option value="' + esc(v.id) + '">' + esc(rotulo(v)) + '</option>').join('');
      const nome = nomeDoCpf(cpf);
      return '<div class="cartao" style="margin:8px 0;padding:10px 12px">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">' +
          '<b style="font-size:1.05em">' + fmt.brl(r.valor) + '</b>' +
          '<span class="nota">' + fmt.data(r.data) + (r.codigo ? ' · ' + esc(r.codigo) : '') + '</span></div>' +
        '<div class="sub" style="margin:2px 0 8px">' +
          (nome ? '<b>' + esc(nome) + '</b> · ' : '') + (cpf ? 'CPF ' + esc(cpf) : 'sem CPF') +
          (doCpf.length ? ' · ' + doCpf.length + ' venda(s) desse CPF' : ' · <b>CPF sem venda no sistema</b>') +
          (r.obs ? ' · ' + esc(r.obs) : '') + '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<select class="vr-venda" data-id="' + esc(r.id) + '" style="flex:1;min-width:0">' +
            '<option value="">— escolher a venda —</option>' + opcoes + '</select>' +
          '<button class="btn mini vr-ok" data-id="' + esc(r.id) + '" style="flex-shrink:0">vincular</button>' +
        '</div></div>';
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
      salvar('rec', Object.assign({}, r, { vendaId: sel.value, conferir: false, editadoAMao: true }));
      b.textContent = '✓'; b.disabled = true; sel.disabled = true;
      toast('Vinculado — o carnê aplica sozinho');
    };
  });
}

/* ── saldo das contas, segundo o Omie ──────────────────────────────────────── */
const K_OMIE_SALDOS = 'bsq_omie_saldos';

// Cache local de 30 min: o painel do Caixa aparece na hora e atualiza quando
// a resposta fresca chega. Devolve { quando, contas, bancario } ou null.
async function saldoBancosOmie(forcar=false) {
  let guardado=null;
  try { guardado=JSON.parse(localStorage.getItem(K_OMIE_SALDOS)||'null'); } catch {}
  if(!forcar&&guardado?.schema===2&&!guardado.parcial&&Date.now()-Date.parse(guardado.quando)<30*60e3)return {...guardado,cache:true};
  try {
    const r=await apiOmie('saldos',{forcar},{prazoMs:90000});
    if(!r?.ok||!Array.isArray(r.contas))throw new Error(r?.error||'Consulta de saldos incompleta.');
    const novo={...r};
    if(!novo.parcial&&!novo.desatualizado)try{localStorage.setItem(K_OMIE_SALDOS,JSON.stringify(novo));}catch{novo.avisoCache='Leitura recebida; não foi possível guardar neste aparelho.';}
    return novo;
  } catch(e) {
    if(guardado)return {...guardado,desatualizado:true,erro:e.message||'Falha ao atualizar saldos.'};
    return {schema:2,contas:[],quando:null,parcial:true,desatualizado:true,erro:e.message||'Saldo indisponível.'};
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
