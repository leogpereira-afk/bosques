/* CADASTROS — clientes e corretores. O id do cliente/corretor é o CPF (só
   dígitos) quando existe: é a mesma regra da importação da planilha, e evita
   o mesmo comprador entrar duas vezes com grafias diferentes. */

function fichaPessoaCorpo(p, ehCorretor) {
  return '<div class="colunas">' +
    campo('Nome', entrada('nome', p.nome || '')) +
    campo('CPF/CNPJ', entrada('cpf', p.cpf || '', { inputmode: 'numeric' })) +
  '</div><div class="colunas">' +
    campo('WhatsApp', entrada('whatsapp', p.whatsapp || '', { inputmode: 'tel' })) +
    campo('Celular', entrada('celular', p.celular || '', { inputmode: 'tel' })) +
  '</div>' +
  campo('E-mail', entrada('email', p.email || '', { tipo: 'email' })) +
  (ehCorretor
    ? '<div class="colunas">' +
        campo('Chave PIX', entrada('chavePix', p.chavePix || '')) +
        campo('Banco / conta', entrada('banco', p.banco || '')) +
      '</div>'
    : campo('Endereço', entrada('endereco', p.endereco || '')) +
      '<div class="colunas-3">' +
        campo('Bairro', entrada('bairro', p.bairro || '')) +
        campo('Cidade', entrada('cidade', p.cidade || 'Montes Claros')) +
        campo('UF', entrada('uf', p.uf || 'MG', { max: 2 })) +
      '</div>') +
  campo('Observações', areaTexto('obs', p.obs || ''));
}

function abrirFichaPessoa(col, id) {
  const ehCorretor = col === 'corretor';
  const p = id ? (achar(col, id) || {}) : {};
  const vendas = id ? lista('venda').filter((v) => (ehCorretor ? v.corretorId : v.clienteId) === id) : [];
  const extras = vendas.length
    ? '<div class="campo"><label>Vendas</label>' + vendas.map((v) =>
        '<div class="nota" style="padding:2px 0">• <a href="#/venda/' + esc(v.id) + '" onclick="fecharModal()">' +
        esc(v.codigo || '') + '</a> Q' + v.quadra + '-L' + v.lote +
        (ehCorretor ? ' · ' + esc(v.clienteNome || '') : '') + ' ' + etiqueta(v.situacao || 'ativa') + '</div>').join('') + '</div>'
    : '';
  abrirModal({
    titulo: (id ? '' : 'Novo ') + (ehCorretor ? 'corretor' : 'cliente') + (p.nome ? ' — ' + p.nome : ''),
    corpo: fichaPessoaCorpo(p, ehCorretor) + extras,
    largo: true,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      ...(id && ehCorretor ? [{
        texto: p.ativo === false ? 'Reativar' : 'Desativar',
        aoClicar: (fundo) => {
          salvar(col, { id, ativo: p.ativo === false });
          fecharSilencioso(fundo);
          TELAS[ehCorretor ? 'corretores' : 'clientes']();
        },
      }] : []),
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        if (!v.nome || !v.nome.trim()) { toast('Diga o nome', 'ruim'); return; }
        const cpf = String(v.cpf || '').replace(/\D/g, '');
        salvar(col, {
          // Sem id ainda: o CPF vira o id (se houver). Registro existente não
          // muda de id — o CPF corrigido fica só no campo.
          id: id || cpf || undefined,
          nome: v.nome.trim().slice(0, 90), cpf,
          whatsapp: String(v.whatsapp || '').slice(0, 30), celular: String(v.celular || '').slice(0, 30),
          email: String(v.email || '').slice(0, 90),
          ...(ehCorretor
            ? { chavePix: String(v.chavePix || '').slice(0, 90), banco: String(v.banco || '').slice(0, 90) }
            : { endereco: String(v.endereco || '').slice(0, 160), bairro: String(v.bairro || '').slice(0, 60),
                cidade: String(v.cidade || '').slice(0, 60), uf: String(v.uf || '').slice(0, 2).toUpperCase(),
                cep: String(v.cep || '').slice(0, 12) }),
          obs: String(v.obs || '').slice(0, 500),
        });
        fecharSilencioso(fundo);
        toast('Salvo');
        TELAS[ehCorretor ? 'corretores' : 'clientes']();
      } },
    ],
  });
}

function telaPessoas(col, titulo, dica) {
  const app = document.getElementById('app');
  const filtro = TELAS['_f' + col] || { q: '' };
  TELAS['_f' + col] = filtro;
  const todos = lista(col).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  const vendas = lista('venda');
  const filtrados = todos.filter((p) => !filtro.q ||
    ((p.nome || '') + ' ' + (p.cpf || '')).toLowerCase().includes(filtro.q.toLowerCase()));

  app.innerHTML =
    '<div class="filtros">' +
      '<input type="search" id="cad-q" placeholder="nome ou CPF…" value="' + esc(filtro.q) + '">' +
      '<button class="btn primario" id="cad-novo">+ ' + titulo.slice(0, -2).toLowerCase() + (titulo === 'Clientes' ? 'e' : '') + '</button>' +
    '</div>' +
    (filtrados.map((p) => {
      const suas = vendas.filter((v) => (col === 'corretor' ? v.corretorId : v.clienteId) === p.id);
      return '<div class="lin' + (p.ativo === false ? ' riscada' : '') + '" data-id="' + esc(p.id) + '">' +
        '<div class="cresce"><b>' + esc(p.nome || '?') + '</b>' +
        '<span class="sub">' + (p.cpf ? fmt.doc(p.cpf) + ' · ' : '') +
          (p.whatsapp || p.celular ? fmt.telefone(p.whatsapp || p.celular) + ' · ' : '') +
          suas.length + ' venda(s)' + (p.ativo === false ? ' · desativado' : '') + '</span></div>' +
        ((p.whatsapp || p.celular) ? '<a class="btn mini whats" target="_blank" rel="noopener" onclick="event.stopPropagation()" href="' +
          linkWhats(p.whatsapp || p.celular, 'Olá, ' + (p.nome || '').split(' ')[0] + '!') + '">WhatsApp</a>' : '') +
      '</div>';
    }).join('') || vazio('👥', 'Ninguém por aqui ainda', dica));

  document.getElementById('cad-q').oninput = (e) => { filtro.q = e.target.value; TELAS[col === 'corretor' ? 'corretores' : 'clientes'](); };
  document.getElementById('cad-novo').onclick = () => abrirFichaPessoa(col, null);
  app.querySelectorAll('.lin[data-id]').forEach((el) => {
    el.onclick = () => abrirFichaPessoa(col, el.dataset.id);
  });
}

TELAS.clientes = () => telaPessoas('cliente', 'Clientes', 'Os compradores entram pela importação ou pela venda.');
TELAS.corretores = () => telaPessoas('corretor', 'Corretores', 'Cadastre quem vende para aparecer nas propostas e comissões.');
