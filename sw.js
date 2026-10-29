/* Service worker — casca offline. SUBA O NÚMERO a cada publicação, senão o
   navegador continua servindo o arquivo velho (lição paga mais de uma vez). */
const CACHE = 'bsq-shell-v91.1';
const ARQUIVOS = [
  'conciliacao-selecao.js',
  './', 'index.html', 'styles.css', 'design.css', 'mapa-espelho.css', 'mapa-espelho.js', 'config.js', 'ui.js', 'store.js', 'carne.js', 'financeiro-core.js', 'financeiro.js', 'financeiro-gestao.js', 'financeiro-painel.js', 'financeiro-painel.css', 'conciliacao.js', 'conciliacao.css',
  'pdf.js', 'espelho.js', 'vendas.js', 'caixa.js', 'cadastros.js', 'cronograma.js', 'apresentacao.js', 'contratos.js', 'omie.js', 'app.js',
  'libs/jspdf.umd.min.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/logo-full.png', 'icons/logo-pdf.png', 'modernizacao.css',
  'icons/3d/home.svg',
  'icons/3d/espelho.svg',
  'icons/3d/simulador.svg',
  'icons/3d/vendas.svg',
  'icons/3d/contratos.svg',
  'icons/3d/propostas.svg',
  'icons/3d/financeiro.svg',
  'icons/3d/relatorios.svg',
  'icons/3d/centros.svg',
  'icons/3d/clientes.svg',
  'icons/3d/corretores.svg',
  'icons/3d/acessos.svg',
  'icons/3d/apresentacao.svg',
  'icons/3d/config.svg'
];

self.addEventListener('install', (e) => {
  // cache:'reload' força buscar DA REDE na instalação — sem isso o cache novo
  // nascia com arquivos velhos herdados do cache HTTP do navegador, e nem
  // "recarregar 2 vezes" resolvia.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ARQUIVOS.map((u) => {
      // A versão na URL também evita que o CDN entregue um arquivo antigo
      // durante a instalação da nova casca.
      const url = new URL(u, self.location.href);
      url.searchParams.set('v', CACHE);
      return new Request(url, { cache: 'reload' });
    })))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    // Só as cascas antigas DESTE sistema: o github.io é um endereço só para
    // todos os sistemas publicados, e apagar tudo derrubava o cache dos outros.
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('bsq-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Só a casca do próprio site; chamadas de API passam direto.
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ||
      fetch(e.request).then((r) => {
        if (r.ok && e.request.method === 'GET') {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return r;
      }))
  );
});
