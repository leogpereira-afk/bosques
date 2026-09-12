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
  async function adicionarAoPdf(doc, valor) {
    if (!String(valor || '').trim()) return false;
    const mapa = arquivo(valor);
    if (!mapa) throw Error('Confira o link do mapa em Configurações antes de salvar o PDF.');
    const controlador = new AbortController(), limite = setTimeout(() => controlador.abort(), 30000);
    try {
      const url = mapa.imagem + (mapa.imagem.includes('?') ? '&' : '?') + 'atualizacao=' + Date.now();
      const resposta = await fetch(url, {signal: controlador.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!resposta.ok) throw Error('imagem');
      const bytes = new Uint8Array(await resposta.arrayBuffer());
      const info = doc.getImageProperties(bytes);
      if (!(info.width > 0 && info.height > 0)) throw Error('dimensões');
      // Uma página A3 exclusiva, sem recorte e sem reduzir os pixels da imagem.
      doc.addPage('a3', info.width > info.height ? 'landscape' : 'portrait');
      const largura = doc.internal.pageSize.getWidth(), altura = doc.internal.pageSize.getHeight();
      const escala = Math.min((largura - 16) / info.width, (altura - 32) / info.height);
      const w = info.width * escala, h = info.height * escala;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(18, 60, 45);
      doc.text('Mapa do empreendimento', 8, 12);
      doc.addImage(bytes, info.fileType, (largura - w) / 2, 18 + (altura - 32 - h) / 2, w, h, 'mapa-espelho', 'FAST');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(95, 122, 102);
      doc.text('Imagem original. Confirme a disponibilidade na lista de lotes e com a equipe.', largura / 2, altura - 7, {align: 'center'});
      return true;
    } catch (_) {
      throw Error('Não foi possível incluir o mapa no PDF. Confira sua conexão e tente salvar novamente.');
    } finally { clearTimeout(limite); }
  }
  return { arquivo, montar, adicionarAoPdf };
})();
