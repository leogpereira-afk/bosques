/* Store — conversa com o servidor, guarda tudo no aparelho e segura a fila
   quando cai a internet.

   Regra de ouro (offline-first): o dado é salvo NO APARELHO primeiro e só
   depois sobe. Quem está na obra sem sinal continua trabalhando; quando a
   internet volta, a fila sobe sozinha. */

// TODAS as coleções do sistema. Ao criar uma nova, acrescente AQUI (e no
// COLECOES do nucleo.mjs) — era em dois lugares e a cotação chegava do
// servidor mas era jogada fora por não existir nesta lista.
const COLECOES_APP = ['movbanco', 'titulo', 'obrigacao', 'conta', 'lote', 'cliente', 'corretor', 'venda', 'prop', 'rec', 'cx', 'doc', 'foto', 'prev', 'etapa'];
const regVazio = () => COLECOES_APP.reduce((a, c) => { a[c] = []; return a; }, {});

const S = {
  cfg: null,
  reg: regVazio(),
  fila: [],
  quem: '',
  senhaHash: '',
  // Quem entrou: perfil manda no menu e nos botões. A porta de verdade é o
  // servidor — isto aqui só evita mostrar o que a pessoa não pode fazer.
  perfil: 'direcao',
  usuarioId: '',
  acessoProprio: false,
  seqFila: 0,
  sincronizando: false,
  ultimoPull: 0,
  cacheCompleto: false,
  erroCache: '',
  online: navigator.onLine,
  erroSync: ''
};

const K = {
  cache: 'bsq_cache_v1',
  fila: 'bsq_fila_v1',
  quem: 'bsq_quem',
  senha: 'bsq_senha',
  perfil: 'bsq_perfil',
  usuario: 'bsq_usuario',
  gruposMenu: 'bsq_grupos_recolhidos'
};

// Espelho do que o servidor faz valer (lib/acesso.mjs). Serve só para não
// mostrar botão que a pessoa não pode apertar — a porta é o servidor.
const ESCRITA_POR_PERFIL = { corretor: ['prop'] };
function podeEscrever(colecao) {
  const permitidas = ESCRITA_POR_PERFIL[S.perfil];
  return !permitidas || permitidas.includes(colecao);
}

/* ── SHA-256 (a senha nunca viaja em texto puro) ───────────────────────────── */
async function sha256(txt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ── Chamada ao servidor ───────────────────────────────────────────────────── */
async function api(action, dados = {}, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-token': TOKEN };
  if (S.senhaHash && !opts.publico) headers['x-senha'] = S.senhaHash;
  if (S.quem) headers['x-quem'] = encodeURIComponent(S.quem);
  // Prazo máximo, valendo também para BAIXAR a resposta: no 4G do canteiro a
  // conexão "pendura" (fica aberta sem resposta, às vezes no meio do download)
  // e sem isso a promessa nunca voltava — travando a tela atrás dela.
  // Download lento que continua chegando não é cortado: durante a leitura da
  // resposta o prazo vira de silêncio (30 s sem receber nada).
  const ctrl = new AbortController();
  let prazo = setTimeout(() => ctrl.abort(), opts.prazoMs || 60000);
  const vigiar = () => { clearTimeout(prazo); prazo = setTimeout(() => ctrl.abort(), opts.silencioMs || PRAZO_SILENCIO_MS); };
  let r, j = null, corpoInvalido = false;
  try {
    r = await fetch(opts.url || API, {
      method: 'POST',
      headers,
      body: JSON.stringify(Object.assign({ action }, dados)),
      signal: ctrl.signal
    });
    vigiar();
    try { j = await lerJson(r, vigiar); } catch (e) { if (ctrl.signal.aborted) throw e; corpoInvalido = true; }
  } catch (e) {
    throw erroDeRede(e);
  } finally {
    clearTimeout(prazo);
  }
  if (!r.ok) {
    const e = new Error((j && (j.error || j.message)) ||
      (r.status >= 500 ? 'O servidor não conseguiu responder (erro ' + r.status + ')' : 'Erro ' + r.status));
    e.status = r.status;
    e.semSenha = !!(j && j.semSenha);
    e.semPermissao = !!(j && j.semPermissao);
    throw e;
  }
  if (corpoInvalido) throw new Error('A resposta do servidor chegou incompleta. Tente de novo.');
  return j;
}

const PRAZO_SILENCIO_MS = 30000;
// Lê o JSON aos pedaços, avisando a cada pedaço que chegou (renova o prazo).
async function lerJson(r, aoReceber) {
  if (!r.body || typeof r.body.getReader !== 'function' || typeof TextDecoder === 'undefined') return r.json();
  const leitor = r.body.getReader(), dec = new TextDecoder();
  let texto = '';
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    aoReceber();
    texto += dec.decode(value, { stream: true });
  }
  return JSON.parse(texto + dec.decode());
}

// O navegador fala inglês ("Failed to fetch"; no iPhone, "Load failed").
function erroDeRede(e) {
  const marcar = (msg) => Object.assign(new Error(msg), { rede: true });
  if (e && e.name === 'AbortError') return marcar('O servidor demorou demais para responder');
  if (/failed to fetch|load failed|networkerror|network request failed|network connection|internet connection/i.test((e && e.message) || '')) return marcar('Sem conexão com o servidor');
  return e;
}

const apiArq = (action, dados = {}, opts = {}) => api(action, dados, Object.assign({ url: API_ARQ }, opts));

/* ── Cache local ───────────────────────────────────────────────────────────── */
function lerCache() {
  try {
    const c = JSON.parse(localStorage.getItem(K.cache) || 'null');
    if (c && c.reg) { S.reg = Object.assign(S.reg, c.reg); S.cfg = c.cfg || null; S.ultimoPull = c.em || 0; }
  } catch { /* cache corrompido: começa limpo */ }
  try { S.fila = JSON.parse(localStorage.getItem(K.fila) || '[]'); } catch { S.fila = []; }
  // O contador PRECISA continuar de onde parou. Se recomeçar do zero, um número
  // novo colide com um já gravado e o envio apaga da fila algo que nunca subiu.
  // Entradas de versões antigas do app (sem seq) ganham um número aqui.
  S.seqFila = S.fila.reduce((m, f) => Math.max(m, Number(f.seq) || 0), 0);
  let faltando = false;
  for (const f of S.fila) if (!f.seq) { f.seq = ++S.seqFila; faltando = true; }
  if (faltando) { try { localStorage.setItem(K.fila, JSON.stringify(S.fila)); } catch { /* segue */ } }
  S.quem = localStorage.getItem(K.quem) || '';
  S.senhaHash = localStorage.getItem(K.senha) || '';
  S.perfil = localStorage.getItem(K.perfil) || 'direcao';
  S.usuarioId = localStorage.getItem(K.usuario) || '';
  S.acessoProprio = !!S.usuarioId;
  // Se o cache tiver se perdido (memória cheia), a fila reconstrói o que ainda
  // não subiu — senão o trabalho feito sem sinal some da tela ao reabrir o app.
  for (const f of S.fila) {
    const arr = S.reg[f.colecao] || (S.reg[f.colecao] = []);
    const i = arr.findIndex((r) => r.id === f.registro.id);
    const rec = Object.assign({}, f.registro, { _pendente: true });
    if (i >= 0) arr[i] = rec; else arr.unshift(rec);
  }
  S.erroSync = erroFilaRecusada();
}

// IndexedDB comporta a base completa; localStorage permanece reservado à fila pequena.
let _dbCache = null, _gravacaoCache = Promise.resolve();
const donoCache = () => [typeof API === 'undefined' ? '' : API, S.perfil, S.usuarioId || ''].join('|');
function abrirBancoLocal() {
  if (_dbCache) return _dbCache;
  _dbCache = new Promise((resolve, reject) => {
    const req = indexedDB.open('bosques-dados', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('cache');
    req.onsuccess = () => { const db=req.result; db.onversionchange=()=>{db.close();_dbCache=null;};resolve(db); };
    req.onerror = () => { _dbCache=null;reject(req.error); };
  });
  return _dbCache;
}
async function cacheLocal(operacao, dados) {
  const db = await abrirBancoLocal();
  return new Promise((resolve, reject) => {
    const tx=db.transaction('cache',operacao==='ler'?'readonly':'readwrite');
    const obj=tx.objectStore('cache');
    const req=operacao==='ler'?obj.get('base'):operacao==='limpar'?obj.clear():obj.put(dados,'base');
    tx.oncomplete=()=>resolve(req.result);
    tx.onerror=()=>reject(tx.error||req.error);
    tx.onabort=()=>reject(tx.error||new Error('Gravação local interrompida'));
  });
}
async function carregarCacheCompleto() {
  if (!S.senhaHash) return;
  const dono=donoCache(),sessao=S.senhaHash;
  try {
    const c=await cacheLocal('ler');
    if (!c?.reg || c.dono!==dono || sessao!==S.senhaHash) return;
    S.reg=Object.assign(regVazio(),c.reg);S.cfg=c.cfg;S.ultimoPull=c.em||0;S.cacheCompleto=!!c.completo;
    // O que ainda não subiu continua prevalecendo sobre o último retrato completo.
    for(const f of S.fila){const arr=S.reg[f.colecao]||(S.reg[f.colecao]=[]);const i=arr.findIndex(r=>r.id===f.registro.id);
      const r={...f.registro,_pendente:true};if(i<0)arr.unshift(r);else arr[i]=r;}
  } catch(e) { S.erroCache='Não foi possível abrir os dados salvos neste computador.'; }
}
function gravarCache() {
  const sessao=S.senhaHash;
  // A escrita é assíncrona. Congela este retrato antes de entrar na fila:
  // guardar referências a S.reg misturava gravações feitas em momentos distintos.
  const dados=JSON.parse(JSON.stringify({reg:S.reg,cfg:S.cfg,em:S.ultimoPull,dono:donoCache(),completo:S.cacheCompleto}));
  _gravacaoCache=_gravacaoCache.then(async()=>{
    if (!sessao || sessao!==S.senhaHash) return;
    await cacheLocal('gravar',dados);
    S.erroCache='';
    localStorage.removeItem(K.cache); // libera espaço só depois da gravação completa
  }).catch(e=>{
    S.erroCache='Não foi possível salvar os dados no computador. Confira o espaço disponível.';
    document.dispatchEvent(new CustomEvent('bsq:status'));
    console.warn('cache local:',e?.message);
  });
  return _gravacaoCache;
}
async function limparCacheCompleto() {
  S.senhaHash='';
  await _gravacaoCache;
  await cacheLocal('limpar');
  S.cacheCompleto=false;S.reg=regVazio();S.cfg=null;
}
function puxarSeNecessario() {
  if (!S.cacheCompleto || Date.now()-S.ultimoPull>=5*60*1000) return puxar();
  if (S.fila.length) return subirFila();
}

// A fila é o que segura o trabalho feito sem internet: se ela não couber no
// aparelho, o usuário PRECISA saber (o cache pode falhar calado, a fila não).
function gravarFila(fila = S.fila) {
  try {
    localStorage.setItem(K.fila, JSON.stringify(fila));
    return true;
  } catch (e) {
    // Tenta abrir espaço jogando fora o cache (ele se refaz no próximo snapshot).
    try {
      localStorage.removeItem(K.cache);
      localStorage.setItem(K.fila, JSON.stringify(fila));
      return true;
    } catch (e2) {
      S.erroSync = 'memória do aparelho cheia — não consigo guardar offline';
      document.dispatchEvent(new CustomEvent('bsq:status'));
      toast('Não foi possível guardar a alteração. Libere espaço no aparelho e tente salvar novamente.', 'ruim');
      return false;
    }
  }
}

/* ── Consultas ─────────────────────────────────────────────────────────────── */
// Lista de uma coleção já sem a lixeira e com o mais novo em cima.
function lista(col, incluirApagados = false) {
  return (S.reg[col] || [])
    .filter((r) => incluirApagados || (!r.apagadoEm && (col !== 'venda' || !r.incorporadaEmVendaId)))
    .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
}

const achar = (col, id) => (S.reg[col] || []).find((r) => r.id === id) || null;

/* ── Gravação ──────────────────────────────────────────────────────────────── */
const novoIdRegistro = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Um formulário pode criar registros relacionados (cliente, venda, entrada).
// O conjunto inteiro precisa caber na fila ANTES de alterar a tela ou iniciar
// envio. É atomicidade no aparelho; o servidor continua confirmando item a item.
function salvarGrupo(itens, opts = {}) {
  if (!itens.length) return [];
  let seq = S.seqFila;
  let proxima = S.fila.slice();
  const preparados = [];
  const anteriores = new Map();
  for (const { colecao: col, registro } of itens) {
    const id = registro.id || novoIdRegistro();
    const chave = col + '|' + id;
    const anterior = anteriores.get(chave) || achar(col, id) || {};
    const local = Object.assign({}, anterior, registro, {
      id, atualizadoEm: new Date().toISOString(), atualizadoPor: S.quem || '—', _pendente: true
    });
    if (!local.criadoEm) { local.criadoEm = local.atualizadoEm; local.criadoPor = S.quem || '—'; }
    // A identidade própria de cada entrada protege edições durante um envio.
    proxima = proxima.filter(f => !(f.colecao === col && f.registro.id === id));
    proxima.push({ colecao: col, registro: local, seq: ++seq });
    preparados.push({ colecao: col, registro: local });
    anteriores.set(chave, local);
  }
  if (!gravarFila(proxima)) {
    throw Object.assign(new Error('Não foi possível guardar a alteração na memória do aparelho.'), { jaAvisado: true });
  }
  S.fila = proxima;
  S.seqFila = seq;
  for (const { colecao: col, registro: local } of preparados) {
    const arr = S.reg[col] || (S.reg[col] = []);
    const i = arr.findIndex(r => r.id === local.id);
    if (i >= 0) arr[i] = local; else arr.unshift(local);
  }
  S.erroSync = erroFilaRecusada();
  gravarCache();
  document.dispatchEvent(new CustomEvent('bsq:status'));

  if (!opts.semSubir) subirFila();
  return preparados.map(f => f.registro);
}

// Mantém o contrato de gravação individual usando a mesma regra de persistência.
function salvar(col, registro, opts = {}) {
  return salvarGrupo([{ colecao: col, registro }], opts)[0];
}

// Acrescenta uma linha no histórico do registro (quem fez, quando, o quê).
function historiar(registro, o_que) {
  const h = Array.isArray(registro.historico) ? registro.historico.slice() : [];
  h.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    em: new Date().toISOString(),
    por: S.quem || '—',
    o_que
  });
  return h;
}

let _subindo = false, _promessaFila = null;
const chaveFila = (colecao, id) => colecao + '|' + id;
function erroFilaRecusada() {
  const recusados = S.fila.filter(f => f.recusado);
  return recusados.length ? recusados.length + ' alteração(ões) aguardam revisão: ' + (recusados[0].erro || 'gravação recusada') : '';
}

// Todos os chamadores aguardam a MESMA operação, inclusive os lotes seguintes.
// Itens recusados permanecem guardados; só correção ou retentativa explícita
// os libera novamente, evitando insistência automática numa permissão negada.
function subirFila() {
  if (_promessaFila) return _promessaFila;
  if (!S.fila.some(f => !f.recusado) || !navigator.onLine) return Promise.resolve();
  _subindo = true;
  _promessaFila = enviarFila().finally(() => {
    _subindo = false;
    _promessaFila = null;
    document.dispatchEvent(new CustomEvent('bsq:status'));
  });
  return _promessaFila;
}

async function enviarFila() {
  while (navigator.onLine) {
    const enviando = S.fila.filter(f => !f.recusado).slice(0, 25);
    if (!enviando.length) break;
    try {
      const r = await api('salvarLote', {
        itens: enviando.map(f => ({ colecao: f.colecao, registro: limparParaEnvio(f.registro) }))
      });
      const salvos = new Map((r.salvos || []).map(s => [chaveFila(s._col, s.id), s]));
      const recusados = new Map((r.recusados || []).map(f => [chaveFila(f.colecao, f.id), f]));
      const enviadas = new Set(enviando);
      const proxima = S.fila.flatMap(f => {
        // Identidade da entrada protege uma edição feita durante a requisição.
        if (!enviadas.has(f)) return [f];
        const chave = chaveFila(f.colecao, f.registro.id);
        if (salvos.has(chave) && !recusados.has(chave)) return [];
        return [{ ...f, recusado: true, erro: recusados.get(chave)?.motivo || 'O servidor não confirmou esta gravação. Confira antes de tentar novamente.' }];
      });
      if (!gravarFila(proxima)) return;
      S.fila = proxima;
      if (recusados.size) document.dispatchEvent(new CustomEvent('bsq:sempermissao', {
        detail: { qtd: recusados.size, msg: [...recusados.values()][0].motivo, itens: [...recusados.values()] }
      }));
      const aindaNaFila = new Set(S.fila.map(f => chaveFila(f.colecao, f.registro.id)));
      for (const salvo of salvos.values()) {
        const col = salvo._col;
        if (aindaNaFila.has(chaveFila(col, salvo.id))) continue;
        const arr = S.reg[col] || (S.reg[col] = []);
        const i = arr.findIndex(x => x.id === salvo.id);
        if (i >= 0) arr[i] = salvo; else arr.unshift(salvo);
      }
      S.erroSync = erroFilaRecusada();
      gravarCache();
      document.dispatchEvent(new CustomEvent('bsq:dados'));
    } catch (e) {
      S.erroSync = e.message || 'falha ao enviar';
      if (e.semSenha) document.dispatchEvent(new CustomEvent('bsq:semsenha'));
      if (e.semPermissao) {
        const enviadas = new Set(enviando);
        const proxima = S.fila.map(f => enviadas.has(f) ? { ...f, recusado: true, erro: e.message || 'gravação recusada' } : f);
        if (gravarFila(proxima)) { S.fila = proxima; S.erroSync = erroFilaRecusada(); }
        document.dispatchEvent(new CustomEvent('bsq:sempermissao', {
          detail: { qtd: enviando.length, msg: e.message, itens: enviando.map(f => ({ colecao: f.colecao, id: f.registro.id, codigo: f.registro.codigo || '', motivo: e.message })) }
        }));
      }
      console.warn('fila:', e.message);
      return;
    }
  }
}

async function tentarNovamenteFila() {
  if (_promessaFila) await _promessaFila;
  const proxima = S.fila.map(f => {
    if (!f.recusado) return f;
    const novo = { ...f }; delete novo.recusado; delete novo.erro;
    return novo;
  });
  if (!gravarFila(proxima)) return;
  S.fila = proxima;
  S.erroSync = '';
  document.dispatchEvent(new CustomEvent('bsq:status'));
  return subirFila();
}

const limparParaEnvio = (r) => { const c = Object.assign({}, r); delete c._pendente; delete c._col; return c; };

// Impressão digital barata do que está na tela: id + quando mudou.
function assinaturaDados() {
  const partes = [];
  for (const col of Object.keys(S.reg)) {
    for (const r of S.reg[col]) partes.push(col + r.id + (r.atualizadoEm || '') + (r.apagadoEm || ''));
  }
  partes.sort();
  return partes.join('|') + '#' + JSON.stringify(S.cfg || null);
}

/* ── Puxar do servidor ─────────────────────────────────────────────────────── */
let _puxando = false;
async function puxar() {
  if (_puxando || !navigator.onLine || !S.senhaHash) return;
  _puxando = true;
  S.sincronizando = true;
  document.dispatchEvent(new CustomEvent('bsq:status'));
  try {
    await subirFila();
    const sessao=S.senhaHash;
    // A base inteira vem numa resposta só: prazo maior que o das ações comuns.
    const r = await api('snapshot', {}, { prazoMs: 120000 });
    if (!sessao || sessao!==S.senhaHash) return;
    const novo = regVazio();
    for (const reg of (r.registros || [])) {
      const col = reg._col;
      if (novo[col]) novo[col].push(reg);
    }
    // Não descarta o que este aparelho acabou de mexer. A LISTAGEM do Blobs
    // tem consistência eventual (~1min): um registro recém-gravado pode não
    // vir no snapshot e sumiria da tela de quem o criou.
    const GRACA_MS = 3 * 60 * 1000;
    const recente = (o) => {
      const t = o.atualizadoEm || o.criadoEm;
      return t && (Date.now() - new Date(t).getTime()) < GRACA_MS;
    };
    const naFila = new Set(S.fila.map((f) => f.colecao + '|' + f.registro.id));
    for (const col of Object.keys(novo)) {
      const vindos = new Set(novo[col].map((x) => x.id));
      for (const local of (S.reg[col] || [])) {
        const chave = col + '|' + local.id;
        if (naFila.has(chave)) {
          // Alteração ainda não enviada SEMPRE ganha da versão do servidor,
          // mesmo que o servidor já conheça o registro — senão o recebimento
          // feito sem sinal era desfeito na tela do próprio autor.
          novo[col] = novo[col].filter((x) => x.id !== local.id);
          novo[col].push(local);
        } else if (!vindos.has(local.id) && recente(local)) {
          // 'prop' de corretor é filtrada por dono no servidor: se deixou de
          // vir no snapshot é porque saiu da lista dele. Não reinjetar.
          if (col === 'prop' && S.perfil === 'corretor') continue;
          novo[col].push(local);
        }
      }
    }
    S.reg = novo;
    S.cfg = r.cfg || S.cfg;
    // O servidor diz o perfil a cada sincronização: se a direção mudar o
    // acesso de alguém, o menu daquela pessoa acompanha sem precisar sair.
    if (r.eu && r.eu.perfil) {
      S.perfil = r.eu.perfil;
      S.acessoProprio = !!r.eu.proprio;
      S.usuarioId = r.eu.proprio ? r.eu.id : '';
      if (r.eu.proprio && r.eu.nome) S.quem = r.eu.nome;
      try {
        localStorage.setItem(K.perfil, S.perfil);
        localStorage.setItem(K.usuario, S.usuarioId);
        if (S.quem) localStorage.setItem(K.quem, S.quem);
      } catch { /* modo privado: segue sem lembrar */ }
    }
    S.cacheCompleto = true;
    S.ultimoPull = Date.now();
    S.erroSync = erroFilaRecusada();
    gravarCache();
    // Só avisa a tela quando algo REALMENTE mudou. Antes, o sync de 90s
    // redesenhava a página do nada e jogava a rolagem pro topo no meio da leitura.
    const assinatura = assinaturaDados();
    if (assinatura !== S.assinatura) {
      // A assinatura só é dada por consumida quando a tela REALMENTE redesenhar
      // (o app.js confirma). Com modal aberto o redesenho é adiado, e sem isso
      // a tela ficaria desatualizada para sempre depois de fechar o modal.
      S.assinaturaPendente = assinatura;
      document.dispatchEvent(new CustomEvent('bsq:dados'));
    }
  } catch (e) {
    S.erroSync = e.message || 'falha ao baixar';
    if (e.semSenha) document.dispatchEvent(new CustomEvent('bsq:semsenha'));
  } finally {
    _puxando = false;
    S.sincronizando = false;
    document.dispatchEvent(new CustomEvent('bsq:status'));
  }
}

/* ── Arquivos grandes (projetos, documentos, fotos) ────────────────────────── */
// 2,5MB por pedaço: em base64 vira ~3,4MB, com folga no limite de corpo que
// a Edge Function do acervo (bsq-acervo) aceita por requisição.
const TAM_PARTE = 2.5 * 1024 * 1024;

function bytesParaBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

function base64ParaBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Sobe um File em partes. onProgresso(0..1) pra barra de progresso.
// Cada parte tem 3 tentativas: no 4G da obra uma falha isolada no meio de uma
// planta de 40MB não pode jogar fora o upload inteiro.
async function enviarArquivo(file, onProgresso, cancelar) {
  const partes = Math.max(1, Math.ceil(file.size / TAM_PARTE));
  const ini = await apiArq('iniciar', {
    nome: file.name, mime: file.type || 'application/octet-stream', tamanho: file.size, partes
  });
  for (let i = 0; i < partes; i++) {
    if (cancelar && cancelar.pedido) throw new Error('envio cancelado');
    const pedaco = file.slice(i * TAM_PARTE, Math.min(file.size, (i + 1) * TAM_PARTE));
    const dados = bytesParaBase64(await pedaco.arrayBuffer());
    let ultimoErro = null;
    for (let tent = 0; tent < 3; tent++) {
      try { await apiArq('parte', { id: ini.id, i, dados }, { prazoMs: 180000 }); ultimoErro = null; break; }
      catch (e) {
        ultimoErro = e;
        // Erro definitivo (senha, parte inválida, arquivo não iniciado) não
        // melhora com insistência — e não vale esperar depois da última tentativa.
        if (e.status && e.status < 500 && e.status !== 429) break;
        if (tent < 2) await new Promise((r) => setTimeout(r, 800 * (tent + 1)));
      }
    }
    if (ultimoErro) throw ultimoErro;
    if (onProgresso) onProgresso((i + 1) / partes);
  }
  const fim = await apiArq('finalizar', { id: ini.id });
  return fim.meta || ini.meta;
}

// Baixa juntando as partes no navegador e devolve um Blob.
async function baixarArquivo(id, onProgresso) {
  const { meta } = await apiArq('meta', { id });
  const pedacos = [];
  const total = meta.partes || 1;
  for (let i = 0; i < total; i++) {
    const r = await apiArq('baixarParte', { id, i }, { prazoMs: 180000 });
    pedacos.push(base64ParaBytes(r.dados));
    if (onProgresso) onProgresso((i + 1) / total);
  }
  return { blob: new Blob(pedacos, { type: meta.mime || 'application/octet-stream' }), meta };
}

function salvarNoAparelho(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome || 'arquivo';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── Rede ──────────────────────────────────────────────────────────────────── */
window.addEventListener('online', () => {
  S.online = true;
  // Com cache recente e fila vazia não haverá requisição para atualizar o aviso.
  document.dispatchEvent(new CustomEvent('bsq:status'));
  subirFila(); puxarSeNecessario();
});
window.addEventListener('offline', () => { S.online = false; document.dispatchEvent(new CustomEvent('bsq:status')); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) puxarSeNecessario();
});
setInterval(() => { if (!document.hidden) puxarSeNecessario(); }, 90000);
