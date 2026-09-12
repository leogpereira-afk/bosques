// A lista pública é reduzida no servidor. Situações desconhecidas ficam de fora.
export function mapaPublico(valor: unknown): string {
  try {
    const u = new URL(String(valor || '').trim());
    if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com' || u.username || u.password || u.port) return '';
    const id = u.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] || (['/open','/uc'].includes(u.pathname) ? u.searchParams.get('id') : '');
    if (!id || !/^[\w-]{10,200}$/.test(id)) return '';
    const chave = u.searchParams.get('resourcekey');
    return 'https://drive.google.com/file/d/' + id + '/view' + (chave && /^[\w-]+$/.test(chave) ? '?resourcekey=' + chave : '');
  } catch (_) { return ''; }
}
export function dadosEspelhoPublico(cfg: any, linhas: any[], geradoEm: string) {
  const exibirReservados = cfg?.espelho?.exibirReservados !== false;
  const lotes = linhas.map(l => l.registro).filter(l => l && (l.status === 'Disponível' || (exibirReservados && l.status === 'Reservado'))).map(l => ({
    quadra: Number(l.quadra) || 0, lote: String(l.lote ?? ''), areaM2: Number(l.areaM2) || 0,
    status: l.status, preco: l.status === 'Disponível' ? (Number(l.preco) || 0) : null,
  }));
  return {
    empresa: { nome: String(cfg?.empresa?.nome || 'Portal dos Bosques'), telefone: String(cfg?.empresa?.telefone || '') },
    lotes, mapaUrl: mapaPublico(cfg?.espelho?.mapaUrl), exibirReservados, geradoEm,
  };
}
