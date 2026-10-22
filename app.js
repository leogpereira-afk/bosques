/* APP — a casca: login, menu, roteador, painel inicial e configurações.
   As telas de negócio moram nos módulos (espelho.js, vendas.js, caixa.js,
   cadastros.js) e se registram em TELAS. */

/* ── Rotas ─────────────────────────────────────────────────────────────────── */
const ROTAS = {
  financeiro: {titulo:'Financeiro',ic:'💰'},
  home:       { titulo: 'Início',        ic: '🏠' },
  espelho:    { titulo: 'Espelho',       ic: '🗺️' },
  lote:       { titulo: 'Lote',          ic: '🗺️', oculta: true },
  vendas:     { titulo: 'Vendas',        ic: '📋' },
  simulador:  { titulo: 'Simulador',     ic: '🏷️' },
  contratos:  { titulo: 'Contratos',     ic: '📜' },
  venda:      { titulo: 'Venda',         ic: '📋', oculta: true },
  propostas:  { titulo: 'Propostas',     ic: '📨' },
  caixa:      { titulo: 'Caixa',         ic: '💰' },
  lancamentos: { titulo: 'Lançamentos',  ic: '🧾' },
  simulacao:  { titulo: 'Simulação',     ic: '🧮', oculta: true }, // vive dentro de Vendas
  relatorios: { titulo: 'Relatórios',   ic: '📊' },
  centros:    { titulo: 'Centro de custos', ic: '🧾' },
  apresentacao: { titulo: 'Apresentação', ic: '🏞️' },
  comissoes:  { titulo: 'Comissões',     ic: '🤝', oculta: true }, // vive dentro de Corretores
  clientes:   { titulo: 'Clientes',      ic: '👥' },
  corretores: { titulo: 'Corretores',    ic: '🧑‍💼' },
  acessos:    { titulo: 'Acessos ao espelho', ic: '🔑' },
  config:     { titulo: 'Configurações', ic: '⚙️' },
};

// O menu é um espelho do servidor: esconder botão não protege nada, só evita
// oferecer o que a pessoa não pode abrir.
function rotasDoPerfil() {
  if (S.perfil === 'corretor') return ['espelho', 'simulador', 'propostas', 'apresentacao'];
  if (S.perfil === 'escritorio') return ['home', 'espelho', 'simulador', 'vendas', 'contratos', 'propostas', 'financeiro', 'relatorios', 'centros', 'clientes', 'corretores', 'apresentacao'];
  return ['home', 'espelho', 'simulador', 'vendas', 'contratos', 'propostas', 'financeiro', 'relatorios', 'centros', 'clientes', 'corretores', 'acessos', 'apresentacao', 'config'];
}

function rotaAtual() {
  const h = location.hash.replace(/^#\/?/, '');
  const [nome, id] = h.split('/');
  return { nome: (nome === 'cronograma' ? 'centros' : nome) || (S.perfil === 'corretor' ? 'espelho' : 'home'), id: id || '' };
}

/* Controles existentes continuam acessíveis também sem mouse. */
let _campoTelaSeq=0;
function prepararBuscaCliente(inp){
  const caixa=document.getElementById('cli-sugestoes');if(!caixa)return [];
  const itens=[...caixa.querySelectorAll('.ac-item')];
  inp.setAttribute('role','combobox');inp.setAttribute('aria-autocomplete','list');inp.setAttribute('aria-controls',caixa.id);
  caixa.setAttribute('role','listbox');caixa.setAttribute('aria-label','Clientes encontrados');
  itens.forEach((it,i)=>{it.id='bsq-cli-opcao-'+i;it.setAttribute('role','option');if(!it.hasAttribute('aria-selected'))it.setAttribute('aria-selected','false');});
  inp.setAttribute('aria-expanded',String(caixa.style.display!=='none'&&itens.length>0));return itens;
}
function ligarAcessibilidadeTela(){
  const app=document.getElementById('app');if(!app)return;
  for(const label of app.querySelectorAll('label:not([for])')){
    const irmao=label.nextElementSibling;
    const controle=label.querySelector('input,select,textarea')||(irmao?.matches('input,select,textarea')?irmao:null);
    if(controle){if(!controle.id)controle.id='bsq-tela-campo-'+(++_campoTelaSeq);label.setAttribute('for',controle.id);}
  }
  for(const el of app.querySelectorAll('div[data-id],div[data-lote],.ct-lin')){
    if(typeof el.onclick!=='function'||el.getAttribute('role')||el.querySelector('a.home-registro'))continue;
    el.setAttribute('role','button');el.setAttribute('tabindex','0');
    el.addEventListener('keydown',e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();el.click();}});
  }
  const busca=document.getElementById('cli-busca');if(busca)prepararBuscaCliente(busca);
}
document.addEventListener('input',e=>{if(e.target?.id==='cli-busca'){e.target.dataset.acPos='-1';prepararBuscaCliente(e.target);}});
document.addEventListener('keydown',e=>{
  const inp=e.target;if(inp?.id!=='cli-busca')return;
  const itens=prepararBuscaCliente(inp),caixa=document.getElementById('cli-sugestoes');
  if(e.key==='Escape'){caixa.style.display='none';inp.setAttribute('aria-expanded','false');return;}
  if(!itens.length||caixa.style.display==='none')return;
  let pos=Number(inp.dataset.acPos??-1);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();pos=e.key==='ArrowDown'?(pos+1)%itens.length:(pos<=0?itens.length-1:pos-1);
    inp.dataset.acPos=String(pos);itens.forEach((it,i)=>it.setAttribute('aria-selected',String(i===pos)));inp.setAttribute('aria-activedescendant',itens[pos].id);
  }else if(e.key==='Enter'&&pos>=0&&itens[pos]){
    e.preventDefault();itens[pos].dispatchEvent(new Event('mousedown',{bubbles:true,cancelable:true}));inp.setAttribute('aria-expanded','false');inp.removeAttribute('aria-activedescendant');
  }
});

/* ── Render ────────────────────────────────────────────────────────────────── */
const DESCRICOES_TELA={home:'O empreendimento hoje, em um só lugar.',espelho:'Disponibilidade, reservas e vendas por lote.',lote:'Informações do lote e condições de venda.',vendas:'Acompanhe contratos, pagamentos e clientes.',venda:'Contrato, parcelas e histórico do cliente.',simulador:'Compare condições e monte um plano de pagamento.',simulacao:'Explore cenários de vendas e recebimentos.',contratos:'Prepare e consulte os contratos do empreendimento.',propostas:'Organize propostas e acompanhe cada negociação.',financeiro:'Caixa, fluxo e carteira de recebimentos.',caixa:'Acompanhe as entradas e saídas do período.',lancamentos:'Consulte e edite cada movimentação.',relatorios:'Meses, anos e comparativos com acesso à origem.',centros:'Gastos por centro de custo e categoria do Omie.',clientes:'Cadastros e informações dos seus clientes.',corretores:'Equipe comercial, desempenho e comissões.',apresentacao:'Fotos e materiais para apresentar o empreendimento.',acessos:'Cadastros de quem entrou pelo link compartilhado.',config:'Preferências e acessos do sistema.'};
const ICONES_MENU={relatorios:'M4 3h16v18H4z M8 16v-4 M12 16V7 M16 16v-7',home:'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',espelho:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',simulador:'M5 3h14v18H5z M8 7h8 M8 11h1 M15 11h1 M8 15h1 M15 15h1 M8 18h1 M15 18h1',vendas:'M4 20V8l8-5 8 5v12H4z M8 12h8 M8 16h5',contratos:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',propostas:'M3 5h18v14H3z M3 5l9 7 9-7',financeiro:'M3 7h18v14H3z M3 7V4h15v3 M15 12h6v5h-6z',centros:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h3 M8 17h7',clientes:'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 6 0 0 1 16 0v2',corretores:'M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M3 20v-2a7 5 0 0 1 14 0v2 M16 4a3 3 0 0 1 0 6 M18 14a5 4 0 0 1 3 4v2',apresentacao:'M3 4h18v16H3z M3 16l6-6 5 5 3-3 4 4 M15 8h.01',config:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2 2 M16.4 16.4l2 2 M5.6 18.4l2-2 M16.4 7.6l2-2 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0'};
function icone3d(nome, classe = '') {
  const destino = ({venda:'vendas',lote:'espelho',simulacao:'simulador',caixa:'financeiro',lancamentos:'financeiro',comissoes:'corretores'})[nome] || nome;
  const arquivo = Object.prototype.hasOwnProperty.call(ROTAS, destino) ? destino : 'home';
  return '<img class="icone-3d '+classe+'" src="icons/3d/'+arquivo+'.svg" width="48" height="48" alt="" aria-hidden="true" decoding="async">';
}
function iconeMenu(nome){return icone3d(nome);}

function grupoMenu(nome){return nome==='home'?'Visão geral':['espelho','simulador','vendas','contratos','propostas'].includes(nome)?'Comercial':['financeiro','relatorios','centros'].includes(nome)?'Gestão':['clientes','corretores','acessos'].includes(nome)?'Cadastros':'Organização';}

function renderLateral() {
  const el = document.getElementById('lateral');
  const { nome } = rotaAtual();
  const totalVendas = resumoComercial().contratos.length;
  el.innerHTML =
    '<div class="marca"><img src="icons/icon-192.png" alt=""><b>Portal dos Bosques<span>gestão do loteamento</span></b></div>' +
    '<nav id="menu">' +
      rotasDoPerfil().map((r,i,rs) =>
        (i===0||grupoMenu(rs[i-1])!==grupoMenu(r)?'<div class="grupo">'+grupoMenu(r)+'</div>':'')+'<a href="#/' + r + '" class="' + (nome === r || (r === 'vendas' && nome === 'venda') || (r === 'espelho' && nome === 'lote') ? 'on' : '') + '">' +
        '<span class="ic">' + iconeMenu(r) + '</span><span class="menu-texto">' + ROTAS[r].titulo+'</span>' +
        (r === 'vendas' ? '<span class="selo" title="Total de vendas, incluindo quitadas">' + totalVendas + '</span>' : '') + '</a>').join('') +
    '</nav>' +
    '<div id="rodape-lateral">' + esc(S.quem || 'Equipe') + ' · ' + esc(({ direcao: 'Direção', escritorio: 'Escritório', corretor: 'Corretor' })[S.perfil] || S.perfil) +
      '<div class="acoes"><button id="bt-sync">↻ Sincronizar</button><button id="bt-sair">Sair</button></div></div>';
  const ativo=el.querySelector('#menu a.on');if(ativo)ativo.setAttribute('aria-current','page');
  const bs = el.querySelector('#bt-sync');
  if (bs) bs.onclick = () => { puxar(); toast('Atualizando dados do aparelho. A integração Omie fica no Financeiro.'); };
  const bx = el.querySelector('#bt-sair');
  if (bx) bx.onclick = sairDoBosques;
}

async function sairDoBosques() {
  if (S.fila.length) { abrirPendenciasEnvio(); return false; }
  if (!await confirmar('Sair do Bosques e remover os dados salvos neste aparelho?')) return false;
  await limparCacheCompleto();
  const chaves = new Set(Object.values(K));
  for (let i=0; i<localStorage.length; i++) { const chave=localStorage.key(i);if(chave&&chave.startsWith('bsq_'))chaves.add(chave); }
  for (const chave of chaves) localStorage.removeItem(chave);
  S.senhaHash = '';
  location.reload();
  return true;
}

function abrirPendenciasEnvio() {
  const itens=S.fila.slice();
  const nomes={prop:'Proposta',venda:'Venda',rec:'Recebimento',cliente:'Cliente',corretor:'Corretor',lote:'Lote',cx:'Lançamento'};
  const m=abrirModal({titulo:'Registros a enviar',largo:true,
    corpo:'<p>Os registros abaixo continuam neste aparelho. A sessão será mantida até o envio ser confirmado. Itens recusados precisam de revisão antes de uma nova tentativa.</p><div class="fila-pendencias">'+
      (itens.map(f=>'<article class="fila-pendencia"><b>'+esc(nomes[f.colecao]||f.colecao)+' · '+esc(f.registro.codigo||f.registro.nome||f.registro.id)+'</b><span class="etiqueta '+(f.recusado?'et-conferir':'et-aberta')+'">'+(f.recusado?'Revisão necessária':'Aguardando envio')+'</span><p>'+esc(f.erro||'Aguardando confirmação do servidor.')+'</p></article>').join('')||'<p>Nenhum registro pendente.</p>')+'</div><p class="erro" id="fila-erro" role="status"></p>',
    acoes:[{texto:'Fechar',aoClicar:()=>fecharModal()},
      {texto:'Guardar cópia das pendências',aoClicar:()=>{salvarNoAparelho(new Blob([JSON.stringify({geradoEm:new Date().toISOString(),itens:S.fila},null,2)],{type:'application/json'}),'bosques-pendencias-'+hojeISO()+'.json');}},
      {texto:'Tentar enviar novamente',classe:'primario',aoClicar:async()=>{
        if(!S.online){m.querySelector('#fila-erro').textContent='Conecte à internet para enviar. As pendências continuam guardadas neste aparelho.';return;}
        try{if(typeof tentarNovamenteFila==='function')await tentarNovamenteFila();else await subirFila();
          if(S.fila.length)m.querySelector('#fila-erro').textContent=S.erroSync||'Ainda há registros sem confirmação. Revise os motivos e tente novamente.';
          else{fecharEste(m);toast('Todos os registros foram confirmados pelo servidor.');render();}}
        catch(e){m.querySelector('#fila-erro').textContent=e.message||'Não foi possível enviar. Os registros foram preservados.';}
      }}]});

}

function renderTopo() {
  const { nome } = rotaAtual();
  const pai={venda:'vendas',lote:'espelho',comissoes:'corretores',simulacao:'vendas',caixa:'financeiro',lancamentos:'financeiro'}[nome];
  const retorno=pai&&(_origemDetalhe||'#/'+pai);
  const nomeRetorno=retorno&&ROTAS[retorno.replace(/^#\/?/,'').split('/')[0]]?.titulo;
  document.getElementById('topo').innerHTML =
    '<div class="titulo-pagina">'+icone3d(nome,'hero-icone')+'<div>'+(retorno?'<a class="voltar-tela" href="'+esc(retorno)+'">← Voltar para '+esc(nomeRetorno||ROTAS[pai].titulo)+'</a>':'<span class="sobretitulo">Portal dos Bosques</span>')+'<h1 tabindex="-1">' + (ROTAS[nome] ? ROTAS[nome].titulo : 'Portal dos Bosques') + '</h1><p>'+esc(DESCRICOES_TELA[nome]||'')+'</p></div></div>' +
    '<label class="atalho-telas">Ir para<select id="ir-tela" aria-label="Ir para outra tela">'+rotasDoPerfil().map(r=>'<option value="'+r+'" '+(r===(pai||nome)?'selected':'')+'>'+ROTAS[r].titulo+'</option>').join('')+'</select></label>'+
    '<div class="topo-situacao"><span id="sync-badge" role="status" aria-live="polite"></span><button type="button" class="btn" id="fila-envio" hidden>Registros a enviar</button></div>';
  document.getElementById('fila-envio').onclick=abrirPendenciasEnvio;
  document.getElementById('ir-tela').onchange=e=>{location.hash='#/'+e.target.value;};
  atualizarBadge();
}

function atualizarBadge() {
  const el = document.getElementById('sync-badge');
  if (!el) return;
  const fila=document.getElementById('fila-envio');if(fila){fila.hidden=!S.fila.length;fila.textContent=S.fila.length+' registro(s) a enviar';}
  const quando = S.ultimoPull ? new Date(S.ultimoPull).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
  if (S.erroCache) { el.className = 'erro'; el.textContent = '⚠ ' + S.erroCache; return; }
  // O erro não esconde de quando são os dados que continuam na tela.
  if (S.erroSync) { el.className = 'erro'; el.textContent = '⚠ ' + S.erroSync + (quando ? ' · dados de ' + quando : ''); return; }
  // Omie parado aparece em toda tela, não só no fim do Início (omie.js).
  const omie = S.perfil !== 'corretor' && typeof S.omieAlerta === 'string' && S.omieAlerta ? ' · 🔴 ' + S.omieAlerta : '';
  el.className = omie ? 'erro' : '';
  el.textContent = (S.sincronizando ? 'sincronizando…'
    : S.fila.length ? S.fila.length + ' a enviar'
    : !S.online ? 'offline — salvando no aparelho'
    : quando ? 'Dados neste aparelho: ' + quando : '') + omie;
}

let _renderPendente = false;
let _edicaoNaTela = false;
function avisarDadosNovos(){
  if(document.getElementById('atualizacao-pendente'))return;
  const aviso=document.createElement('div');aviso.id='atualizacao-pendente';aviso.className='atualizacao-pendente';aviso.setAttribute('role','status');
  aviso.innerHTML='<span>Há dados novos. Sua edição foi preservada.</span><button type="button" class="btn">Aplicar atualização</button>';
  aviso.querySelector('button').onclick=async()=>{if(_edicaoNaTela&&!await confirmar('Aplicar os dados novos? Os campos ainda não salvos desta tela serão descartados.'))return;render();};
  document.getElementById('topo').after(aviso);
}
function atualizarSemPerderEdicao(){
  if((typeof _modalAberto!=='undefined'&&_modalAberto)||_edicaoNaTela){_renderPendente=true;if(_edicaoNaTela)avisarDadosNovos();return;}
  render();
}
for(const evento of ['input','change'])document.addEventListener(evento,e=>{if(e.target?.closest?.('#app')&&e.target.matches('input,textarea,select'))_edicaoNaTela=true;});
function render() {
  if (!S.senhaHash) { renderLogin(); return; }
  _renderPendente = false;_edicaoNaTela=false;document.getElementById('atualizacao-pendente')?.remove();
  // Confirma para o store que a tela consumiu o retrato novo — sem isso o
  // sync de 90s redesenharia a página toda vez, jogando a rolagem pro topo.
  if (S.assinaturaPendente) { S.assinatura = S.assinaturaPendente; S.assinaturaPendente = null; }
  const { nome, id } = rotaAtual();
  document.body.dataset.tela=nome;
  renderLateral();
  renderTopo();
  // Versão visível no rodapé: dá para saber quem já está com a publicação nova.
  const versao = document.getElementById('versao-app');
  if (versao && window.VERSAO && !versao.textContent) versao.textContent = ' · v' + window.VERSAO;
  const rotas = rotasDoPerfil().concat(S.perfil==='corretor'?['lote']:['lote', 'venda', 'comissoes', 'simulacao', 'caixa', 'lancamentos', 'relatorios']);
  const tela = rotas.includes(nome) && TELAS[nome] ? TELAS[nome] : null;
  if (S.cacheCompleto === false) {
    document.getElementById('app').innerHTML='<section class="cartao" role="status"><h2>'+ (S.erroSync?'Dados ainda indisponíveis':'Preparando os dados do sistema') +'</h2><p>'+esc(S.erroSync||'Aguarde a leitura completa. Os indicadores serão apresentados juntos, com a mesma base de dados.')+'</p><button class="btn" id="dados-tentar">Tentar carregar novamente</button></section>';
    document.getElementById('dados-tentar').onclick=()=>puxar();return;
  }
  if (tela) { tela(id);ligarAcessibilidadeTela(); }
  else location.hash = '#/' + rotasDoPerfil()[0];
  if (S.perfil !== 'corretor') vigiarSaudeOmie();
}

/* ── Login ─────────────────────────────────────────────────────────────────── */
function renderLogin() {
  document.body.innerHTML =
    '<div class="tela-login"><div class="caixa-login">' +
      '<img src="icons/icon-192.png" alt="">' +
      '<h1>Portal dos Bosques</h1>' +
      '<div class="sub">gestão do loteamento</div>' +
      '<label for="lg-nome">Seu nome</label><input type="text" id="lg-nome" placeholder="Seu nome" autocomplete="name" value="' + esc(S.quem || '') + '">' +
      '<label for="lg-senha">Senha</label><input type="password" id="lg-senha" placeholder="Senha" autocomplete="current-password">' +
      '<div class="erro" id="lg-erro"></div>' +
      '<button class="btn primario" id="lg-entrar">Entrar</button>' +
    '</div></div>';
  const entrar = async () => {
    const nome = document.getElementById('lg-nome').value.trim();
    const senha = document.getElementById('lg-senha').value;
    const erro = document.getElementById('lg-erro');
    if (!senha) { erro.textContent = 'Digite a senha.'; return; }
    const btn = document.getElementById('lg-entrar');
    btn.disabled = true; btn.textContent = 'entrando…';
    try {
      S.senhaHash = await sha256(senha);
      S.quem = nome;
      const r = await api('entrar');
      if (!r.ok) throw new Error(r.error || 'Senha incorreta');
      S.perfil = r.perfil || 'direcao';
      S.usuarioId = r.proprio ? r.usuarioId : '';
      S.acessoProprio = !!r.proprio;
      if (r.proprio && r.nome) S.quem = r.nome;
      if (!S.quem) S.quem = 'Equipe';
      localStorage.setItem(K.senha, S.senhaHash);
      localStorage.setItem(K.quem, S.quem);
      localStorage.setItem(K.perfil, S.perfil);
      localStorage.setItem(K.usuario, S.usuarioId);
      location.reload(); // recomeça limpo com a casca inteira
    } catch (e) {
      S.senhaHash = '';
      erro.textContent = e.message || 'Não deu para entrar agora.';
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };
  document.getElementById('lg-entrar').onclick = entrar;
  document.getElementById('lg-senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
}

/* ── Tela: início (o retrato do dia) ───────────────────────────────────────── */
TELAS.home = function () {
  const app = document.getElementById('app');
  const mes = mesDe(hojeISO());
  const t = FIN_GESTAO.resumo(FIN_GESTAO.filtrar(GESTAO_UI.base().movimentos,{ano:mes.slice(0,4),mes:mes.slice(5)}));
  const vivas = vendasVivas();
  const comAtraso = vivas
    .map((v) => ({ v, r: resumoVenda(v) }))
    .filter((x) => x.r.qtdAtraso > 0)
    .sort((a, b) => b.r.emAtraso - a.r.emAtraso);
  const totalAtraso = comAtraso.reduce((s, x) => s + x.r.emAtraso, 0);
  const ultimosRecs = lista('rec').sort((a, b) => String(b.data || '').localeCompare(a.data || '')).slice(0, 6);
  const propsQuentes = lista('prop').filter((p) => (p.situacao || 'enviada') === 'enviada' &&
    (p.eventos || []).some((e) => e.tipo === 'interesse'));

  const comercial=resumoComercial();
  const atalhos=[['espelho','Encontrar um lote','Disponibilidade e mapa'],['simulador','Simular condições','Compare os planos de pagamento'],['propostas','Acompanhar propostas',propsQuentes.length?propsQuentes.length+' com interesse registrado':'Sua fila de negociações'],['financeiro','Conferir o financeiro','Movimentos e contas em aberto']];
  app.innerHTML = '<section class="home-hero"><div>'+icone3d('home','hero-icone')+'</div><div class="home-boas-vindas"><span class="sobretitulo">Gestão do loteamento</span><h2>Seu dia no Bosques.</h2><p>Consulte os lotes, acompanhe as propostas e confira os recebimentos.</p><div class="home-acoes"><span>'+comercial.disponiveis+' lotes disponíveis</span><span>'+comercial.vendidos+' vendidos</span><span>Propostas com interesse: '+propsQuentes.length+'</span></div></div><a class="btn primario" data-disponiveis href="#/espelho">Ver lotes disponíveis →</a></section>'+
    '<nav class="home-atalhos" aria-label="Ações principais">'+atalhos.map(([rota,titulo,descricao])=>'<a class="home-atalho" href="#/'+rota+'">'+icone3d(rota,'atalho-icone')+'<span><b>'+titulo+'</b><small>'+descricao+'</small></span><span aria-hidden="true">↗</span></a>').join('')+'</nav>'+
    painelInadimplenciaOmie()+
    '<div class="paineis">' +
      '<button class="painel clicavel painel-modernizado" data-vai="financeiro" data-aba="recebimentos">'+icone3d('financeiro','kpi-icone')+'<span class="rot">Entradas · ' + nomeMes(mes) + '</span>' +
        '<span class="num fin-entrada">' + fmt.brl(t.entradas) + '</span></button>' +
      '<button class="painel clicavel painel-modernizado" data-vai="financeiro" data-aba="despesas">'+icone3d('centros','kpi-icone')+'<span class="rot">Saídas · ' + nomeMes(mes) + '</span><span class="num fin-saida">' + fmt.brl(t.saidas) + '</span></button>' +
      '<button class="painel clicavel painel-modernizado" data-vai="relatorios">'+icone3d('relatorios','kpi-icone')+'<span class="rot">Resultado do mês</span>' +
        '<span class="num ' + (t.resultado >= 0 ? 'fin-entrada' : 'fin-saida') + '">' + fmt.brl(t.resultado) + '</span></button>' +
      '<button class="painel clicavel painel-modernizado" data-vai="vendas">'+icone3d('vendas','kpi-icone')+'<span class="rot">Atraso nas fichas confirmadas</span>' +
        '<span class="num fin-atraso">' + fmt.brl(totalAtraso) + '</span>' +
        '<span class="sub">' + comAtraso.length + ' contrato(s)</span></button>' +
    '</div>' +
    (propsQuentes.length ? '<div class="cartao home-secao"><h2>Propostas que pedem retorno</h2>' +
      propsQuentes.slice(0, 5).map((p) => '<button type="button" class="lin prop-lin" data-id="' + esc(p.id) + '">' +
        '<div class="cresce"><b>' + esc((p.cliente && p.cliente.nome) || '?') + ' · Q' + p.quadra + '-L' + p.lote + '</b>' +
        '<span class="sub">clicou "tenho interesse" · proposta de ' + esc(p.donoNome || '—') + '</span></div>' +
        '<span class="etiqueta et-hoje">Responder</span></button>').join('') + '</div>' : '') +
    '<div class="home-operacao"><section class="cartao home-secao"><div class="home-secao-titulo"><h2>Prioridades de cobrança</h2><a href="#/vendas">Ver carteira →</a></div><p class="nota">Saldos em aberto, dos maiores para os menores.</p>' +
      (comAtraso.slice(0, 8).map(({ v, r }) =>
        '<div class="lin venda-lin" data-id="' + esc(v.id) + '">' +
        '<a class="cresce home-registro" href="#/venda/'+esc(v.id)+'"><b>Q' + v.quadra + '-L' + v.lote + ' · ' + esc(v.clienteNome || '?') + '</b>' +
        '<span class="sub">' + r.qtdAtraso + ' parcela(s) vencida(s)</span></a>' +
        botaoCobranca(v, r, true) +
        '<span class="dinheiro" style="color:var(--ruim)">' + fmt.brl(r.emAtraso) + '</span></div>').join('') ||
        '<p class="nota">Sem atraso nas fichas confirmadas. Os títulos ainda sem lote aparecem no quadro do Omie.</p>') + '</section>' +
    '<section class="cartao home-secao"><div class="home-secao-titulo"><h2>Últimos recebimentos</h2><a href="#/financeiro">Ver financeiro →</a></div>' +
      (ultimosRecs.map((rc) => {
        const v = achar('venda', rc.vendaId);
        return '<button class="lin home-rec" data-rec="' + esc(rc.id) + '">' +
          '<span class="cresce"><b class="fin-entrada">' + fmt.brl(rc.valor) + '</b>' +
          '<span class="sub">' + fmt.data(rc.data) + ' · ' + (v ? 'Q' + v.quadra + '-L' + v.lote + ' · ' + esc(v.clienteNome || '') : 'Sem lote confirmado · abrir recebimento') + '</span></span></button>';
      }).join('') || '<p class="nota">Nenhum recebimento registrado.</p>') + '</section></div>' +
    // O pulso da ponte com o Omie: quando sincronizou e se deu certo.
    (S.perfil !== 'corretor'
      ? '<p class="nota" id="home-omie" style="margin:6px 2px">consultando a sincronização do Omie…</p>'
      : '');

  const disponiveis=app.querySelector('[data-disponiveis]');if(disponiveis)disponiveis.onclick=()=>{TELAS._fEspelho={q:'',quadra:'',status:'Disponível',atraso:false};};
  if (S.perfil !== 'corretor') statusOmieHome(document.getElementById('home-omie'));
  ligarBotoesCobranca(app);
  app.querySelectorAll('[data-vai]').forEach((el) => { el.onclick = () => {
    if(el.dataset.aba)TELAS._fin={aba:el.dataset.aba,ano:mes.slice(0,4),mes:mes.slice(5),q:''};
    if(el.dataset.vai==='relatorios')TELAS._relMes=mes;
    if(el.dataset.vai==='vendas')TELAS._fVendas={q:'',sit:'',so:'atraso'};
    location.hash = '#/' + el.dataset.vai;
  }; });
  app.querySelectorAll('[data-rec]').forEach(el=>{el.onclick=()=>finEditarRecebimento(achar('rec',el.dataset.rec),()=>render());});
  app.querySelectorAll('.venda-lin').forEach((el) => { el.onclick = () => { location.hash = '#/venda/' + el.dataset.id; }; });
  app.querySelectorAll('.prop-lin').forEach((el) => { el.onclick = () => abrirFichaProposta(el.dataset.id); });
};

/* ── Tela: configurações (direção) ─────────────────────────────────────────── */
TELAS.config = function () {
  const app = document.getElementById('app');
  const cfg = S.cfg || {};
  const emp = cfg.empresa || {};
  const reaj = cfg.reajuste || { pct: 6, aCada: 12 };
  const usuarios = cfg.usuarios || [];

  app.innerHTML =
    '<div class="cartao"><h2>Empresa</h2><div class="colunas">' +
      campo('Nome', entrada('empresa.nome', emp.nome || '')) +
      campo('Nome curto', entrada('empresa.nomeCurto', emp.nomeCurto || '')) +
    '</div><div class="colunas-3">' +
      campo('CNPJ', entrada('empresa.cnpj', emp.cnpj || '')) +
      campo('WhatsApp da casa', entrada('empresa.telefone', emp.telefone || ''), 'fallback do botão da proposta') +
      campo('Cidade', entrada('empresa.cidade', emp.cidade || 'Montes Claros')) +
    '</div>' +
    campo('Dados para pagamento (saem na proposta)', areaTexto('empresa.contaBancaria', emp.contaBancaria || '',
      'ex.: PIX (CNPJ): 00.000.000/0001-00 · Banco Sicoob ag 0000 c/c 00000-0 · Associação Campestre Portal dos Bosques')) +
    '<h2 style="margin-top:8px">Regras de venda</h2><div class="colunas-3">' +
      campo('Reajuste (%)', entrada('reajuste.pct', reaj.pct, { inputmode: 'decimal' }), 'da parcela "Reajustada"') +
      campo('a cada quantas parcelas', entrada('reajuste.aCada', reaj.aCada, { inputmode: 'numeric' })) +
      campo('Validade da proposta (dias)', entrada('validadeProposta', cfg.validadeProposta || 7, { inputmode: 'numeric' })) +
    '</div><div class="colunas-3">' +
      campo('Entrada padrão (R$)', entrada('entradaPadrao', cfg.entradaPadrao || 3000, { inputmode: 'decimal' }), 'o simulador já abre com ela') +
    '</div>' +
    '<h2 style="margin-top:8px">🏷️ Centros de custo <span class="nota">— classificam as despesas; aparecem nos lançamentos e nos relatórios</span></h2>' +
    campo('Um centro por linha', areaTexto('centrosCustoTxt', (cfg.centrosCusto || []).join('\n'),
      'ex.:\nPortaria\nRede de água\nRede de energia\nRuas\nAdministração\nComercial'), 'depois de salvar, o campo "Centro de custo" aparece em toda despesa') +
    '<button class="btn primario" id="cf-salvar">Salvar configurações</button></div>' +

    '<div class="cartao" id="cf-espelho"><h2>Espelho e mapa</h2>' +
      '<p class="nota">O mapa abre dentro do Espelho e do link compartilhado. A lista pública mostra apenas disponíveis e reservados.</p>' +
      campo('Link do arquivo do mapa no Google Drive', entrada('espelho.mapaUrl', cfg.espelho?.mapaUrl || '', { tipo: 'url', placeholder: 'https://drive.google.com/file/d/…/view' }),
        'O arquivo deve permitir visualização por quem tem o link. Use o link do arquivo, não o da pasta. Atualize esse mesmo arquivo no Drive para manter o mapa atual. Se criar outro arquivo, substitua o link aqui.') +
      campo('Lotes no link compartilhado', seletor('espelho.exibirReservados', cfg.espelho?.exibirReservados === false ? 'nao' : 'sim', [
        {v:'sim',t:'Disponíveis e reservados'},{v:'nao',t:'Somente disponíveis'}])) +
      '<div id="cf-mapa-erro" class="mapa-erro" role="alert"></div>' +
      '<div class="espelho-config-acoes"><button class="btn primario" id="cf-espelho-salvar">Salvar espelho e mapa</button>' +
      '<button class="btn" id="cf-mapa-ver">Conferir mapa</button><button class="btn" id="cf-espelho-link">Compartilhar espelho</button></div>' +
      '<h3 style="margin-top:22px">Senha do link compartilhado</h3><p class="nota" id="cf-senha-status">' + (cfg.espelhoSenhaConfigurada ? 'Senha configurada. Quem recebe o link precisa se identificar e informar a senha.' : 'Configure a senha para liberar o link compartilhado.') + '</p>' +
      campo('Nova senha comum', entrada('senhaEspelho', '', {tipo:'password',autocomplete:'new-password'}), 'Use pelo menos 6 caracteres. Trocar a senha encerra os acessos anteriores.') +
      '<div class="espelho-config-acoes"><button class="btn" id="cf-senha-espelho">Salvar senha do espelho</button><a class="btn" href="#/acessos">Ver cadastros de acesso</a></div>' +
    '</div>' +

    '<div class="cartao"><h2>Acessos da equipe <span class="nota">— um por pessoa; o histórico diz quem fez</span></h2>' +
      (usuarios.map((u) =>
        '<div class="lin us-lin" data-id="' + esc(u.id) + '"' + (u.ativo === false ? ' style="opacity:.55"' : '') + '>' +
        '<div class="cresce"><b>' + esc(u.nome) + '</b><span class="sub">' +
        esc(({ direcao: 'Direção', escritorio: 'Escritório', corretor: 'Corretor' })[u.perfil] || u.perfil) +
        (u.ultimoAcesso ? ' · entrou ' + fmt.quando(u.ultimoAcesso) : ' · nunca entrou') +
        (u.ativo === false ? ' · DESATIVADO' : '') + '</span></div></div>').join('') || '<p class="nota">Só a senha da equipe por enquanto.</p>') +
      '<div class="acoes-linha"><button class="btn primario" id="cf-novo-acesso">+ Acesso</button>' +
      '<button class="btn" id="cf-senha-equipe">Trocar a senha da equipe</button></div></div>' +

    '<div class="cartao"><h2>Omie (ERP) <span class="nota">— boletos, pagamentos e cadastros entram sozinhos</span></h2>' +
    '<div class="colunas-3">' +
      campo('Recebimentos valem a partir de', entrada('omieCorte', (cfg.omie && cfg.omie.corteEntradas) || '', { tipo: 'date' }),
        'antes disso, o que vale é a planilha — recuar duplica se o mês já foi digitado') +
    '</div><div class="acoes-linha">' +
      '<button class="btn primario" id="cf-omie-sync">↻ Sincronizar agora</button>' +
      (S.perfil==='direcao'?'<button class="btn" id="cf-auditoria-aplicar">Aplicar correções preparadas</button>':'')+
    '</div><p class="nota" id="cf-auditoria-progresso" role="status"></p><div class="nota" id="cf-omie-saude" style="margin-top:8px">conferindo a última sincronização…</div></div>' +

    '<div class="cartao"><h2>Manutenção</h2><div class="acoes-linha">' +
      '<button class="btn" id="cf-backup">⬇ Baixar backup</button>' +
      '<button class="btn" id="cf-log">📜 Últimas ações</button>' +
      '<button class="btn perigo" id="cf-lixeira">Esvaziar a lixeira</button>' +
    '</div><div class="nota" id="cf-saude" style="margin-top:8px">conferindo o backup automático…</div></div>';

  // O backup que ninguém confere é fé, não backup: a tela pergunta ao
  // servidor qual foi o ÚLTIMO DIA GRAVADO na tabela — e grita se atrasou.
  (async () => {
    const el = document.getElementById('cf-saude');
    try {
      const r = await api('saude');
      const ult = (r.backups && r.backups[0]) || null;
      if (!ult) { el.innerHTML = '⚠ <b>Nenhum backup na tabela ainda.</b>'; el.style.color = 'var(--ruim)'; return; }
      const hoje = hojeISO();
      const ontem = CARNE.venc(hoje, 0) && new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const atrasado = ult.dia < ontem;
      el.innerHTML = (atrasado
        ? '🔴 <b>Backup atrasado!</b> O último é de ' + fmt.data(ult.dia) + ' — a rotina das 03:10 não está entregando. Avise quem cuida do sistema.'
        : '🟢 Backup automático em dia: último em <b>' + fmt.data(ult.dia) + '</b>' +
          (r.rotina && r.rotina.registros ? ' com <b>' + r.rotina.registros + ' registros</b>' : '') +
          ' · roda sozinho todo dia às 03:10 e guarda 60 dias.');
      if (atrasado) el.style.color = 'var(--ruim)';
    } catch (e) {
      el.textContent = '⚠ Não consegui conferir o backup agora: ' + (e.message || 'sem resposta');
    }
  })();

  const lerEspelho = () => {
    const v = lerCampos(document.getElementById('cf-espelho')).espelho || {};
    const texto = String(v.mapaUrl || '').trim(), mapa = MAPA_ESPELHO.arquivo(texto);
    if (texto && !mapa) throw Error('Cole o link do arquivo do mapa no Google Drive. O link de uma pasta não abre a imagem diretamente.');
    return { ...(cfg.espelho || {}), mapaUrl: mapa?.url || '', exibirReservados: v.exibirReservados === 'sim' };
  };
  document.getElementById('cf-espelho-salvar').onclick = async () => {
    const erro = document.getElementById('cf-mapa-erro'), botao = document.getElementById('cf-espelho-salvar');
    try {
      erro.textContent = ''; const espelho = lerEspelho(); botao.disabled = true;
      const r = await api('salvarCfg', { cfg: { espelho } });
      S.cfg = { ...S.cfg, ...r.cfg }; gravarCache(); toast('Mapa e lotes do link atualizados');
    } catch (e) { erro.textContent = e.message || 'Não foi possível salvar'; }
    finally { botao.disabled = false; }
  };
  document.getElementById('cf-mapa-ver').onclick = () => {
    try {
      const espelho = lerEspelho(); if (!espelho.mapaUrl) throw Error('Informe o link do arquivo do mapa.');
      abrirModal({ titulo: 'Mapa atualizado', corpo: '<section id="cf-mapa-preview"></section>', largo: true });
      MAPA_ESPELHO.montar(document.getElementById('cf-mapa-preview'), espelho.mapaUrl);
    } catch (e) { document.getElementById('cf-mapa-erro').textContent = e.message; }
  };
  document.getElementById('cf-espelho-link').onclick = abrirLinkEspelho;
  document.getElementById('cf-senha-espelho').onclick = async () => {
    const entradaSenha=app.querySelector('[data-campo="senhaEspelho"]'), erro=document.getElementById('cf-mapa-erro'), b=document.getElementById('cf-senha-espelho');
    try {
      if(entradaSenha.value.length<6)throw Error('Use pelo menos 6 caracteres na senha.');
      b.disabled=true;erro.textContent='';
      const r=await api('salvarSenhaEspelho',{novaHash:await sha256(entradaSenha.value)});
      S.cfg={...S.cfg,...r.cfg};gravarCache();entradaSenha.value='';document.getElementById('cf-senha-status').textContent='Senha configurada. Os acessos anteriores foram encerrados.';toast('Senha do espelho salva');
    }catch(e){erro.textContent=e.message||'Não foi possível salvar a senha.';}finally{b.disabled=false;}
  };
  document.getElementById('cf-salvar').onclick = async () => {
    const v = lerCampos(app);
    try {
      const r = await api('salvarCfg', { cfg: {
        espelho: lerEspelho(),
        empresa: { ...emp, ...v.empresa },
        reajuste: { pct: numeroBR(v.reajuste.pct), aCada: Math.max(1, Math.round(numeroBR(v.reajuste.aCada))) },
        validadeProposta: Math.max(1, Math.round(numeroBR(v.validadeProposta))),
        entradaPadrao: Math.max(0, numeroBR(v.entradaPadrao)) || 3000,
        omie: { ...(cfg.omie || {}), corteEntradas: v.omieCorte || (cfg.omie && cfg.omie.corteEntradas) || '' },
        centrosCusto: String(v.centrosCustoTxt || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 40),
      } });
      S.cfg = { ...S.cfg, ...r.cfg };
      gravarCache();
      toast('Configurações salvas');
    } catch (e) { toast(e.message || 'Não salvou', 'ruim'); }
  };
  // Mesma avaliação do Início; a consulta se renova sem recriar este formulário.
  statusOmieConfig(document.getElementById('cf-omie-saude'));
  const auditoriaBotao=document.getElementById('cf-auditoria-aplicar');
  if(auditoriaBotao)auditoriaBotao.onclick=async()=>{
    const progresso=document.getElementById('cf-auditoria-progresso');
    auditoriaBotao.disabled=true;
    try{
      const r=await aplicarCorrecoesPreparadas(p=>{progresso.textContent=p.atual+' de '+p.total+' itens processados; conferência final na origem ainda pendente.';});
      progresso.textContent=r.concluidas+' correções conferidas na origem. '+r.pendentes+' pendências.';
      await puxar();
    }catch(e){progresso.textContent=e.message||'Conferência interrompida. Consulte o controle da auditoria.';}
    finally{auditoriaBotao.disabled=false;}
  };
  document.getElementById('cf-omie-sync').onclick = async () => {
    const b = document.getElementById('cf-omie-sync');
    b.disabled = true; b.textContent = 'sincronizando…';
    try {
      const r = await sincronizarOmie(true);
      toast('Omie: ' + resumoOmie(r && r.contagens));
      TELAS.config();
    } catch (e) {
      toast(e.message || 'Não sincronizou', 'ruim');
      b.disabled = false; b.textContent = '↻ Sincronizar agora';
    }
  };
  document.getElementById('cf-novo-acesso').onclick = () => abrirAcesso(null);
  app.querySelectorAll('.us-lin').forEach((el) => { el.onclick = () => abrirAcesso(el.dataset.id); });
  document.getElementById('cf-senha-equipe').onclick = async () => {
    const nova = await perguntar('Nova senha da equipe (mín. 6 caracteres)', { titulo: 'Senha da equipe', obrigatorio: true });
    if (!nova) return;
    if (nova.length < 6) { toast('Curta demais', 'ruim'); return; }
    try {
      await api('trocarSenha', { novaHash: await sha256(nova) });
      toast('Senha da equipe trocada — avise quem usa');
    } catch (e) { toast(e.message || 'Não trocou', 'ruim'); }
  };
  document.getElementById('cf-backup').onclick = async () => {
    try {
      const r = await api('backup');
      baixarTexto('backup-bosques-' + hojeISO() + '.json', JSON.stringify(r, null, 1));
    } catch (e) { toast(e.message || 'Falhou', 'ruim'); }
  };
  document.getElementById('cf-log').onclick = async () => {
    try {
      const r = await api('log', { limite: 100 });
      abrirModal({
        titulo: 'Últimas ações',
        corpo: (r.linhas || []).map((l) =>
          '<div class="nota" style="padding:3px 0">' + fmt.dataHora(l.em) + ' — <b>' + esc(l.por || '') + '</b> ' +
          esc(l.acao || '') + (l.detalhe ? ' · ' + esc(l.detalhe) : '') + (l.codigo ? ' · ' + esc(l.codigo) : '') +
          (l.valor ? ' · ' + fmt.brl(l.valor) : '') + '</div>').join('') || '<p class="nota">Vazio.</p>',
        largo: true,
        acoes: [{ texto: 'Fechar', aoClicar: () => fecharModal() }],
      });
    } catch (e) { toast(e.message || 'Falhou', 'ruim'); }
  };
  document.getElementById('cf-lixeira').onclick = async () => {
    if (await confirmar('Apagar DE VEZ tudo que está na lixeira, junto com os arquivos que só esses registros usavam?', { perigo: true, ok: 'Esvaziar' })) {
      try {
        const r = await api('esvaziarLixeira');
        toast('Lixeira esvaziada: ' + r.apagados + ' registro(s), ' + r.arquivos + ' arquivo(s)');
      } catch (e) { toast(e.message || 'Falhou', 'ruim'); }
    }
  };
};

function abrirAcesso(id) {
  const u = id ? ((S.cfg && S.cfg.usuarios) || []).find((x) => x.id === id) : null;
  const corretores = lista('corretor').filter((c) => c.ativo !== false);
  const corpo =
    '<div class="colunas">' +
      campo('Nome', entrada('nome', u ? u.nome : '')) +
      campo('Cargo', entrada('cargo', u ? u.cargo : '')) +
    '</div><div class="colunas">' +
      campo('Perfil', seletor('perfil', u ? u.perfil : 'escritorio',
        [{ v: 'direcao', t: 'Direção — tudo' }, { v: 'escritorio', t: 'Escritório — opera o dia a dia' }, { v: 'corretor', t: 'Corretor — espelho e propostas' }])) +
      campo('Senha ' + (u ? '(deixe vazio p/ manter)' : ''), entrada('senha', '', { tipo: 'password' })) +
    '</div>' +
    campo('É um corretor do cadastro?', seletor('corretorId', u ? u.corretorId : '',
      corretores.map((c) => ({ v: c.id, t: c.nome })), 'não'), 'liga o acesso às comissões dele') +
    (u ? '<div class="campo"><label><input type="checkbox" data-campo="ativo" ' + (u.ativo !== false ? 'checked' : '') + ' style="width:auto;margin-right:6px">acesso ativo</label></div>' : '');
  abrirModal({
    titulo: u ? 'Acesso de ' + u.nome : 'Novo acesso',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      ...(u ? [{ texto: 'Remover', classe: 'perigo', aoClicar: async (fundo) => {
        if (await confirmar('Remover o acesso de ' + u.nome + '? A pessoa para de entrar na hora.', { perigo: true, ok: 'Remover' })) {
          try {
            const r = await api('apagarUsuario', { id: u.id });
            S.cfg = { ...S.cfg, ...r.cfg }; gravarCache();
            fecharSilencioso(fundo); TELAS.config();
          } catch (e) { toast(e.message || 'Falhou', 'ruim'); }
        }
      } }] : []),
      { texto: 'Salvar', classe: 'primario', aoClicar: async (fundo) => {
        const v = lerCampos(fundo);
        if (!v.nome || !v.nome.trim()) { toast('Diga o nome', 'ruim'); return; }
        if (!u && (!v.senha || v.senha.length < 6)) { toast('Senha de pelo menos 6 caracteres', 'ruim'); return; }
        if (v.senha && v.senha.length < 6) { toast('Senha curta demais', 'ruim'); return; }
        try {
          const r = await api('salvarUsuario', { usuario: {
            id: u ? u.id : undefined, nome: v.nome.trim(), cargo: v.cargo, perfil: v.perfil,
            corretorId: v.corretorId || '',
            ativo: u ? !!v.ativo : true,
            ...(v.senha ? { novaHash: await sha256(v.senha) } : {}),
          } });
          if (!r.ok) throw new Error(r.error || 'Não salvou');
          S.cfg = { ...S.cfg, ...r.cfg }; gravarCache();
          fecharSilencioso(fundo);
          toast('Acesso salvo');
          TELAS.config();
        } catch (e) { toast(e.message || 'Não salvou', 'ruim'); }
      } },
    ],
  });
}

/* ── Versão nova do app ────────────────────────────────────────────────────── */
let _swRegistro = null, _swConferido = 0;
function conferirVersaoNova() {
  if (!_swRegistro || document.hidden || Date.now() - _swConferido < 15 * 60e3) return;
  _swConferido = Date.now();
  _swRegistro.update().catch(() => {});
}
function avisarVersaoNova() {
  if (document.getElementById('versao-nova')) return;
  const aviso = document.createElement('div');
  aviso.id = 'versao-nova'; aviso.setAttribute('role', 'status');
  aviso.innerHTML = '<span>Há uma versão nova do sistema.</span><button type="button" class="btn">Atualizar agora</button>';
  aviso.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(aviso);
}
document.addEventListener('visibilitychange', conferirVersaoNova);
// Versão nova publicada: a casca nova assume em segundo plano, mas esta tela
// continuaria rodando a antiga até fechar o app (no iPhone instalado, por dias).
// O ouvinte entra já ao carregar o arquivo, antes de qualquer espera: a troca
// pode acontecer enquanto o app ainda lê a base do aparelho.
const _tinhaControleSW = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('controllerchange', () => { if (_tinhaControleSW) avisarVersaoNova(); });

/* ── Eventos e partida ─────────────────────────────────────────────────────── */
document.addEventListener('bsq:status', () => { atualizarBadge(); if(S.senhaHash && S.cacheCompleto===false && !S.sincronizando) atualizarSemPerderEdicao(); });
document.addEventListener('bsq:dados', atualizarSemPerderEdicao);
document.addEventListener('ui:modais-fechados', () => { if (_renderPendente && !_edicaoNaTela) render(); });
document.addEventListener('bsq:semsenha', () => {
  localStorage.removeItem(K.senha);
  S.senhaHash = '';
  toast('Sua sessão expirou — entre de novo', 'ruim');
  setTimeout(() => location.reload(), 900);
});
document.addEventListener('bsq:sempermissao', (e) => {
  const d = e.detail || {};
  toast('Não salvou: ' + (d.msg || 'seu acesso não permite'), 'ruim');
});
window.addEventListener('beforeunload',e=>{if(S.fila.length||_edicaoNaTela){e.preventDefault();e.returnValue='';}});
let _origemDetalhe='';
const _rolagemRotas=new Map();
window.addEventListener('hashchange', e=>{
  const anterior=(e.oldURL||'').split('#')[1]||'/home',nova=rotaAtual();
  const antes=anterior.replace(/^\//,'').split('/')[0];
  const detalhes=['venda','lote','comissoes','simulacao','caixa','lancamentos'];
  if(detalhes.includes(nova.nome)) {if(!detalhes.includes(antes)&&ROTAS[antes])_origemDetalhe='#'+anterior;}
  else _origemDetalhe='';
  _rolagemRotas.set('#'+anterior,window.scrollY||0);
  render();
  document.querySelector('#topo h1')?.focus({preventScroll:true});
  window.scrollTo(0,_rolagemRotas.get(location.hash)||0);
});

(async function iniciar() {
  lerCache();
  await carregarCacheCompleto();
  if (!window.BOSQUES_PREVIA && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => { _swRegistro = reg; }).catch(() => {});
  }
  render();
  const appVisivel=document.getElementById('app');
  if(typeof MutationObserver!=='undefined'&&appVisivel){const a11y=new MutationObserver(ligarAcessibilidadeTela);a11y.observe(appVisivel,{childList:true,subtree:true});}
  if (S.senhaHash) { puxarSeNecessario(); talvezSincronizarOmie(); }
})();
