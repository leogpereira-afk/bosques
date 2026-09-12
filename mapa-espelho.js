/* O mapa permanece no Drive. Cada abertura consulta a imagem do mesmo arquivo. */
const MAPA_ESPELHO = (() => {
  function arquivo(valor) {
    try {
      const u = new URL(String(valor || '').trim());
      if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com' || u.username || u.password || u.port) return null;
      const id = u.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] || (['/open','/uc'].includes(u.pathname) ? u.searchParams.get('id') : '');
      if (!id || !/^[\w-]{10,200}$/.test(id)) return null;
      const chave = u.searchParams.get('resourcekey');
      const extra = chave && /^[\w-]+$/.test(chave) ? '?resourcekey=' + chave : '';
      return { url: 'https://drive.google.com/file/d/' + id + '/view' + extra, imagem: 'https://lh3.googleusercontent.com/d/' + id + '=w2400' + extra };
    } catch (_) { return null; }
  }
  function montar(alvo, valor) {
    const mapa = arquivo(valor); alvo.replaceChildren(); alvo.hidden = !mapa;
    if (!mapa) return;
    const topo = document.createElement('div');topo.className='mapa-topo';
    const texto = document.createElement('div'), h = document.createElement('h2');h.textContent='Mapa atualizado';
    const nota = document.createElement('p');nota.textContent='Imagem original do empreendimento. Consulte a disponibilidade atual na lista de lotes.';texto.append(h,nota);
    const botoes = document.createElement('div');botoes.className='mapa-acoes';
    const ampliar = document.createElement('button');ampliar.type='button';ampliar.className='btn secundario';ampliar.textContent='Ampliar mapa';ampliar.setAttribute('aria-pressed','false');
    const atualizar = document.createElement('button');atualizar.type='button';atualizar.className='btn secundario';atualizar.textContent='Atualizar mapa';
    const aviso = document.createElement('p');aviso.className='mapa-aviso';aviso.setAttribute('role','status');
    const visor = document.createElement('div');visor.className='mapa-visor';visor.tabIndex=0;visor.setAttribute('role','region');visor.setAttribute('aria-label','Imagem do mapa; amplie para ver os detalhes e role para navegar');
    const img = document.createElement('img');img.alt='Mapa atualizado do Portal dos Bosques';img.referrerPolicy='no-referrer';img.decoding='async';
    img.onload=()=>{aviso.hidden=true;};
    img.onerror=()=>{aviso.hidden=false;aviso.textContent='Não foi possível carregar o mapa. Confira sua conexão e toque em Atualizar mapa.';};
    const carregar=()=>{aviso.hidden=false;aviso.textContent='Carregando mapa…';img.src=mapa.imagem+(mapa.imagem.includes('?')?'&':'?')+'atualizacao='+Date.now();};
    ampliar.onclick=()=>{const zoom=visor.classList.toggle('mapa-zoom');ampliar.textContent=zoom?'Ver mapa inteiro':'Ampliar mapa';ampliar.setAttribute('aria-pressed',String(zoom));visor.scrollTop=0;visor.scrollLeft=0;};
    atualizar.onclick=carregar;
    botoes.append(ampliar,atualizar);topo.append(texto,botoes);visor.append(img);
    alvo.classList.add('mapa-espelho');alvo.append(topo,aviso,visor);carregar();
  }
  return { arquivo, montar };
})();
