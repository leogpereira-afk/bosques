// bsq-omie — a ponte com o ERP Omie (app.omie.com.br).
//
// O Omie é onde os boletos dos carnês vivem e onde os pagamentos caem
// conciliados. Esta função puxa de lá o que aconteceu de verdade:
//   • conta a RECEBER baixada  → vira 'rec' (aparece no carnê e no caixa);
//   • conta a PAGAR paga       → vira 'cx' saída com categoria mapeada;
//   • cadastro de cliente      → completa os campos vazios do nosso;
//   • boleto em aberto         → consultado na hora para a cobrança.
//
// Regras duras aprendidas na análise dos dados reais (24/08/2026):
//   1. ListarMovimentos duplica cada baixa (título + espelho CONTA_CORRENTE_*).
//      Só os grupos CONTA_A_RECEBER / CONTA_A_PAGAR contam.
//   2. Entradas da planilha NÃO casam linha a linha com o Omie (a planilha
//      agrega por venda/mês; 200 de 302 sem par). Por isso recebimento do
//      Omie só entra a partir da DATA DE CORTE (cfg.omie.corteEntradas) —
//      o passado continua sendo o da planilha.
//   3. Saídas casam bem (85% dia+valor). Despesa do Omie com par exato na
//      planilha é pulada; par no mesmo mês com dia diferente vira PENDÊNCIA
//      listada (nunca lançamento automático — dois gastos iguais no mesmo
//      mês existem de verdade).
//   4. Filtros exóticos da API mentem em silêncio (devolvem "500"). Os dois
//      confiáveis, validados contra o dump completo: dDtAltDe no
//      ListarMovimentos e nCodCliente no PesquisarLancamentos.

import { json, preflight } from "../_shared/cors.ts";
import {
  agora, db, lerUm, gravarUm, gravarCfg, gravarVarios, guardarIndiceNumero, lerCfgBruta,
  lerColecaoBruta, marcarMudanca, proximoNumero, registrarLog,
} from "../_shared/dados.ts";
import { identificar, perfilDe, type Quem } from "../_shared/acesso.ts";

/* ── conversa com o Omie ───────────────────────────────────────────────────── */
const OMIE_URL = "https://app.omie.com.br/api/v1/";

async function omie(modulo: string, call: string, param: Record<string, unknown>) {
  const APP_KEY = Deno.env.get("BSQ_OMIE_APP_KEY");
  const APP_SECRET = Deno.env.get("BSQ_OMIE_APP_SECRET");
  if (!APP_KEY || !APP_SECRET) throw new Error("Faltam os segredos BSQ_OMIE_APP_KEY / BSQ_OMIE_APP_SECRET.");
  const resp = await fetch(OMIE_URL + modulo + "/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }),
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error("Omie " + call + ": " + (corpo.faultstring || resp.status));
  return corpo;
}

/* ── miudezas ──────────────────────────────────────────────────────────────── */
const soDigitos = (s: unknown) => String(s || "").replace(/\D/g, "");
const centavos = (v: unknown) => Math.round((Number(v) || 0) * 100);

// O Deno das Edge Functions roda em UTC: das 21h à meia-noite no Brasil,
// toISOString().slice(0,10) já devolve AMANHÃ. O dia que vale é o do Brasil (UTC-3).
const diaBrasil = (dt: string | number | Date = Date.now()) =>
  new Date(new Date(dt).getTime() - 3 * 3600e3).toISOString().slice(0, 10);

// Tipo do título no Omie → nossa forma de pagamento. O MESMO mapa vale para
// recebimento e despesa (senão PIX/dinheiro/cartão de saída viram "Transferência").
const FORMA: Record<string, string> = { PIX: "PIX", BOL: "Boleto", CARNE: "Boleto",
  DIN: "Dinheiro", CRC: "Cartão de Crédito", CRD: "Cartão de Débito", TRF: "Transferência" };

// "21/08/2026" → "2026-08-21"; qualquer outra coisa → "".
function brParaISO(d: unknown): string {
  const p = String(d || "").split("/");
  return p.length === 3 ? p[2] + "-" + p[1] + "-" + p[0] : "";
}
// "2026-08-21" → "21/08/2026" (formato que os filtros do Omie exigem).
function isoParaBR(d: string): string {
  const p = d.slice(0, 10).split("-");
  return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : "";
}

// Categoria do Omie → nossa categoria de despesa. Prefixo mais específico
// primeiro; o que não casar vira "Outros" e o cartão de vínculos pendentes
// do Caixa cobra a classificação.
const MAPA_CATEGORIA: [string, string][] = [
  ["2.02.01", "Comissão"],
  ["2.02.02", "Marketing"],
  ["2.04.10", "Contabilidade"],
  ["2.07.01", "Obra / infraestrutura"],   // máquinas e equipamentos
  ["2.07.04", "Administrativo"],          // informática
  ["2.07.06", "Telefone / internet"],
  ["2.01", "Obra / infraestrutura"],      // matéria prima, serviços, mercadorias
  ["2.03", "Funcionários"],               // salários, adiantamentos
  ["2.04", "Administrativo"],
  ["2.05", "Tarifas bancárias"],
  ["2.06", "Impostos e taxas"],
];
function categoriaLocal(codOmie: string): string {
  for (const [prefixo, nossa] of MAPA_CATEGORIA) {
    if ((codOmie || "").startsWith(prefixo)) return nossa;
  }
  return "Outros";
}

async function lerMeta(chave: string): Promise<any | null> {
  const { data } = await db.from("bsq_meta").select("valor").eq("chave", chave).maybeSingle();
  return data ? data.valor : null;
}
async function gravarMeta(chave: string, valor: unknown): Promise<void> {
  const { error } = await db.from("bsq_meta").upsert({ chave, valor, atualizado_em: agora() });
  if (error) throw new Error("meta " + chave + ": " + error.message);
}

/* ── cadastro de clientes do Omie (também é o mapa CPF → código) ───────────── */
async function clientesDoOmie(): Promise<any[]> {
  const todos: any[] = [];
  let pagina = 1;
  while (pagina <= 5) {                       // 117 hoje; 5 páginas = teto de 1.500
    const r = await omie("geral/clientes", "ListarClientes", { pagina, registros_por_pagina: 300 });
    todos.push(...(r.clientes_cadastro || []));
    if (pagina >= (r.total_de_paginas || 1)) break;
    pagina += 1;
  }
  return todos;
}

/* ── o casamento título → venda ────────────────────────────────────────────── */
// Entre as vendas vivas do cliente, qual bate com o valor do título?
// Confere o valor da parcela e, na Reajustada, cada degrau possível.
// Só aceita quando EXATAMENTE UMA venda casa — ambiguidade vai para conferência.
// O boleto sai pelo valor CHEIO e tem ~20% de desconto de pontualidade — o
// valorParcela do sistema é o valor COM desconto. Um pagamento pode chegar
// pelos dois valores (pagou em dia ou não), então os dois casam, com uma
// tolerância pequena (arredondamentos do banco).
const aproxima = (aCent: number, bCent: number) =>
  Math.abs(aCent - bCent) <= Math.max(2, Math.round(bCent * 0.015));
function casarVenda(vendas: any[], valorTitulo: number, cfg: any): string {
  if (vendas.length === 1) return vendas[0].id;
  const alvo = centavos(valorTitulo);
  const pct = Number(cfg?.reajuste?.pct ?? 6);
  const casam = vendas.filter((v) => {
    const base = Number(v.valorParcela) || 0;
    if (!base) return false;
    for (let degrau = 0; degrau <= 14; degrau++) {
      const c = centavos(base * Math.pow(1 + pct / 100, degrau));
      if (aproxima(alvo, c) || aproxima(alvo, Math.round(c / 0.8))) return true;
      if (v.tipoParcela !== "Reajustada") break;
    }
    return false;
  });
  return casam.length === 1 ? casam[0].id : "";
}

/* ══════════════════════════════════════════════════════════════════════════ */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const h = Object.fromEntries(req.headers);
  const token = h["x-token"] || body.token;
  const TOKEN = Deno.env.get("BSQ_TOKEN");
  if (!TOKEN || token !== TOKEN) return json({ error: "Não autorizado" }, 401);

  const cfg = await lerCfgBruta();
  const quem: Quem | null = await identificar(cfg, h["x-senha"] || body.senha || "");
  if (!quem) return json({ error: "Senha inválida", semSenha: true }, 403);
  const perfil = perfilDe(quem);
  // Corretor não mexe com o financeiro — nem para ler boleto de cliente.
  if (perfil === "corretor") return json({ error: "Seu acesso não permite isso." }, 403);
  const por = (quem.proprio && quem.nome) || "—";

  const { action } = body;

  try {
    switch (action) {

      /* ── saúde: a última sincronização, para o indicador da tela ─────────── */
      case "saude": {
        const meta = await lerMeta("omie_sync");
        return json({ ok: true, sync: meta || null, corte: cfg.omie?.corteEntradas || null });
      }

      /* ── sincronizar: puxa do Omie o que mudou e espelha aqui ────────────── */
      // Paginado entre chamadas: devolve { continua: N } enquanto houver página;
      // o painel chama de novo com { pagina: N, parcial } até vir continua: null.
      case "sincronizar": {
        if (perfil !== "direcao" && perfil !== "escritorio") {
          return json({ error: "Só direção e escritório sincronizam." }, 403);
        }
        const meta = await lerMeta("omie_sync");

        // Primeira sincronização crava o corte: recebimento do Omie só vale
        // daqui em diante. A direção pode recuar a data nas Configurações.
        let corte = cfg.omie?.corteEntradas || "";
        if (!corte) {
          // Dia do BRASIL, não o UTC do Deno: às 21h+ daqui o UTC já é amanhã,
          // e um corte em "amanhã" descartaria as baixas do próprio dia para sempre.
          corte = diaBrasil();
          await gravarCfg({ ...cfg, omie: { ...(cfg.omie || {}), corteEntradas: corte }, atualizadoEm: agora() });
          await marcarMudanca("cfg");
        }

        // Janela incremental: só o que o Omie alterou desde a última rodada
        // completa (3 dias de carência). Sem meta — ou a pedido — vem tudo.
        const completa = !!body.completa || !meta?.quando;
        const janela: Record<string, unknown> = {};
        if (!completa) {
          const de = new Date(new Date(meta.quando).getTime() - 3 * 86400e3);
          janela.dDtAltDe = isoParaBR(de.toISOString());
        }

        // Estado local, uma leitura por chamada.
        // lerColecaoBruta devolve linhas { id, registro } — aqui só o registro importa.
        const [vendas, clientesLocais, corretores, recs, cxs] = (await Promise.all([
          lerColecaoBruta("venda"), lerColecaoBruta("cliente"),
          lerColecaoBruta("corretor"), lerColecaoBruta("rec"), lerColecaoBruta("cx"),
        ])).map((linhas) => linhas.map((l: any) => l.registro));
        const vendasPorCpf = new Map<string, any[]>();
        for (const v of vendas) {
          if (v.apagadoEm || v.situacao === "distratada") continue;
          const cpf = soDigitos(v.clienteId);
          if (!vendasPorCpf.has(cpf)) vendasPorCpf.set(cpf, []);
          vendasPorCpf.get(cpf)!.push(v);
        }
        const recPorId = new Map(recs.map((r: any) => [r.id, r]));
        const cxPorId = new Map(cxs.map((c: any) => [c.id, c]));
        // Dedupe contra lançamento manual é por CONTAGEM, não por conjunto:
        // cada linha manual "cobre" UM título do Omie. Dois títulos gêmeos
        // (tids distintos, mesmo dia e valor) são legítimos — com Set, uma
        // única baixa manual engolia os dois e um pagamento real sumia.
        const conta = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
        const consome = (m: Map<string, number>, k: string) => {
          const n = m.get(k) || 0;
          if (!n) return false;
          m.set(k, n - 1);
          return true;
        };
        // Baixa manual já lançada: chave venda|valor|data.
        const baixasManuais = new Map<string, number>();
        for (const r of recs) {
          if (r.apagadoEm || String(r.id).startsWith("rbomie-")) continue;
          conta(baixasManuais, (r.vendaId || "") + "|" + centavos(r.valor) + "|" + String(r.data || "").slice(0, 10));
        }
        // Saída já registrada (planilha ou à mão): dia+valor e mês+valor.
        const saidasDia = new Map<string, number>(); const saidasMes = new Map<string, number>();
        for (const c of cxs) {
          if (c.apagadoEm || c.tipo !== "saida" || String(c.id).startsWith("cxomie-")) continue;
          conta(saidasDia, centavos(c.valor) + "|" + String(c.data || "").slice(0, 10));
          conta(saidasMes, centavos(c.valor) + "|" + String(c.data || "").slice(0, 7));
        }
        const corretorPorDoc = new Map<string, string>();
        for (const c of corretores) {
          if (c.apagadoEm) continue;
          if (soDigitos(c.cpf)) corretorPorDoc.set(soDigitos(c.cpf), c.id);
          if (soDigitos(c.chavePix).length >= 11) corretorPorDoc.set(soDigitos(c.chavePix), c.id);
        }

        // Cadastro do Omie (na 1ª chamada da rodada): mapa de códigos + enriquecimento.
        const cont: Record<string, number> = { ...(body.parcial || {}) };
        const soma = (k: string, n = 1) => { cont[k] = (cont[k] || 0) + n; };
        const gravar: { colecao: string; id: string; registro: any }[] = [];

        if (!body.pagina || body.pagina === 1) {
          const doOmie = await clientesDoOmie();
          const mapaCpf: Record<string, number> = {};
          const porCpfLocal = new Map(clientesLocais.map((c: any) => [soDigitos(c.cpf || c.id), c]));
          for (const oc of doOmie) {
            const cpf = soDigitos(oc.cnpj_cpf);
            if (!cpf) continue;
            mapaCpf[cpf] = oc.codigo_cliente_omie;
            const local = porCpfLocal.get(cpf);
            if (!local || local.apagadoEm) continue;
            // Decisão do Léo (25/08): o cadastro do Omie MANDA sobre o que veio
            // da planilha — sobrescreve quando o Omie tem o dado. Só recua para
            // "completar vazios" quando uma PESSOA editou o registro no app
            // (aí o que ela digitou fica).
            const autor = String(local.atualizadoPor || "");
            const editadoPorPessoa = !["omie", "auditoria Omie", "—", ""].includes(autor) &&
              !autor.startsWith("importação");
            const tel = [oc.telefone1_ddd, oc.telefone1_numero].filter(Boolean).join(" ");
            // O campo que o cadastro (e o botão de cobrança) usa é o whatsapp.
            const cand: Record<string, string> = {
              email: oc.email || "", whatsapp: tel, endereco: oc.endereco || "",
              bairro: oc.bairro || "", cidade: (oc.cidade || "").replace(/\s*\(.+\)\s*$/, ""),
              uf: oc.estado || "", cep: oc.cep || "",
            };
            let mudou = false;
            const novo = { ...local };
            for (const [campo, valor] of Object.entries(cand)) {
              if (!valor) continue;
              const atual2 = String(novo[campo] || "").trim();
              if (!atual2 || (!editadoPorPessoa && atual2 !== valor)) { novo[campo] = valor; mudou = true; }
            }
            if (mudou) {
              novo.atualizadoEm = agora();
              novo.historico = [...(local.historico || []),
                { em: agora(), por: "omie", acao: editadoPorPessoa
                  ? "completou cadastro com dados do Omie"
                  : "cadastro atualizado pelo Omie (dados da planilha substituídos)" }];
              gravar.push({ colecao: "cliente", id: novo.id, registro: novo });
              soma("clientesCompletados");
            }
          }
          await gravarMeta("omie_clientes", { quando: agora(), mapaCpf });
        }

        // As páginas de movimentos desta chamada.
        // O ESPELHO DAS PARCELAS: todo título de cliente (aberto ou pago)
        // vira parcela ARMAZENADA na venda — v.parcelas é a verdade do carnê,
        // e o que o Léo editar à mão (trava) a sincronização respeita.
        const titulosPorVenda = new Map<string, any[]>();
        const anotarTitulo = (vendaId: string, item: any) => {
          if (!titulosPorVenda.has(vendaId)) titulosPorVenda.set(vendaId, []);
          titulosPorVenda.get(vendaId)!.push(item);
        };
        // Onde cada tid JÁ mora entre as vendas do cliente (distratada conta;
        // lixeira não): título conhecido atualiza a parcela onde ela está —
        // nunca vira cópia noutra venda. Sem isso, tid % N muda de destino
        // quando N muda (nova venda ou distrato) e a parcela duplica.
        const tidDonoCache = new Map<string, Map<string, string>>();
        const tidDono = (cpf: string) => {
          let m = tidDonoCache.get(cpf);
          if (!m) {
            m = new Map<string, string>();
            for (const vv of vendas) {
              if (vv.apagadoEm || soDigitos(vv.clienteId) !== cpf) continue;
              for (const pz of (vv.parcelas || [])) if (pz && pz.tid) m.set(String(pz.tid), vv.id);
            }
            tidDonoCache.set(cpf, m);
          }
          return m;
        };
        const POR_CHAMADA = 15;
        let pagina = Number(body.pagina) || 1;
        let totPaginas = pagina;
        const fim = pagina + POR_CHAMADA;
        const pendNovas: any[] = [];
        // O mesmo título pode aparecer mais de uma vez na listagem (baixa em
        // partes). A ficha do dedupe é POR TÍTULO: a 2ª ocorrência do mesmo
        // tid repete o pulo, em vez de gastar outra ficha (ou criar o rec).
        const tidsCobertos = new Set<string>();

        while (pagina < fim) {
          const r = await omie("financas/mf", "ListarMovimentos",
            { nPagina: pagina, nRegPorPagina: 100, ...janela });
          totPaginas = r.nTotPaginas || 1;
          for (const mov of r.movimentos || []) {
            const d = mov.detalhes || {}; const res = mov.resumo || {};
            const grupo = d.cGrupo || "";

            /* recebimento de venda baixado */
            if (grupo === "CONTA_A_RECEBER") {
              // espelho das parcelas: casa o título com a venda e anota
              if (d.cStatus !== "CANCELADO") {
                const cpfT = soDigitos(d.cCPFCNPJCliente);
                const minhasT = vendasPorCpf.get(cpfT) || [];
                const cheio = Math.round((Number(d.nValorTitulo) || 0) * 100) / 100;
                // Tid que já mora numa venda: atualiza LÁ. O casamento por
                // valor e o tid % N só valem para título ainda desconhecido.
                let vId = tidDono(cpfT).get(String(d.nCodTitulo)) || "";
                let conferirT = false;
                if (!vId) vId = minhasT.length === 1 ? minhasT[0].id : casarVenda(minhasT, cheio, cfg);
                if (!vId && minhasT.length) {
                  // Ambíguo (cliente com N vendas de parcela igual): distribui
                  // por tid % N. N é o nº de vendas vivas e MUDA (nova venda,
                  // distrato) — por isso o tid conhecido é procurado antes,
                  // acima; só título novo cai aqui. Fica marcado; a edição
                  // move se for o caso.
                  const ordenadas = minhasT.slice().sort((x: any, y: any) =>
                    String(x.dataVenda || "").localeCompare(String(y.dataVenda || "")) ||
                    String(x.codigo || "").localeCompare(String(y.codigo || "")));
                  vId = ordenadas[Number(d.nCodTitulo) % ordenadas.length].id;
                  conferirT = true;
                }
                if (vId) {
                  const recebido = d.cStatus === "RECEBIDO" && res.cLiquidado === "S";
                  anotarTitulo(vId, {
                    tid: d.nCodTitulo, venc: brParaISO(d.dDtVenc), valor: cheio,
                    valorDia: Math.round(cheio * 0.8 * 100) / 100,
                    pago: recebido ? brParaISO(d.dDtPagamento) : null,
                    pagoValor: recebido ? (Number(res.nValPago) || cheio) : null,
                    pagoOrigem: recebido ? "omie" : null,
                    ...(conferirT ? { conferir: true } : {}),
                  });
                }
              } else {
                // Título CANCELADO no Omie (renegociação de carnê): a parcela
                // espelhada não pode ficar viva para sempre — anota para o
                // merge tirar do espelho (ou marcar, se for travada).
                const dono = tidDono(soDigitos(d.cCPFCNPJCliente)).get(String(d.nCodTitulo));
                if (dono) anotarTitulo(dono, { tid: d.nCodTitulo, cancelado: true });
              }
              const id = "rbomie-" + d.nCodTitulo;
              const existente = recPorId.get(id);
              if (d.cStatus === "RECEBIDO" && res.cLiquidado === "S") {
                const dataPagto = brParaISO(d.dDtPagamento);
                if (!dataPagto || dataPagto < corte) { soma("recAntesDoCorte"); continue; }
                if (existente && !existente.apagadoEm) { soma("recJaEspelhado"); continue; }
                const valor = Number(res.nValPago) || Number(d.nValorTitulo) || 0;
                if (existente && existente.apagadoEm && existente.apagadoPor !== "omie") {
                  // Uma PESSOA mandou este espelho para a lixeira (estorno
                  // local = lixeira + relançar): a sync respeita e não
                  // ressuscita. Só o que a própria sync apagou ("omie",
                  // estorno lá) pode renascer num re-recebimento.
                  if (centavos(existente.valor) !== centavos(valor)) {
                    pendNovas.push({ titulo: d.nCodTitulo, valor, data: dataPagto,
                      categoria: "recebimento apagado na lixeira aqui — o valor no Omie difere",
                      categoriaOmie: "" });
                  }
                  soma("recNaLixeira"); continue;
                }
                const cpf = soDigitos(d.cCPFCNPJCliente);
                const minhas = vendasPorCpf.get(cpf) || [];
                const vendaId = casarVenda(minhas, valor, cfg);
                const tidRec = String(d.nCodTitulo);
                if (vendaId && (tidsCobertos.has(tidRec) ||
                    consome(baixasManuais, vendaId + "|" + centavos(valor) + "|" + dataPagto))) {
                  tidsCobertos.add(tidRec);
                  soma("recBaixadoAMao"); continue;
                }
                const numero = await proximoNumero("rec");
                // A forma REAL do pagamento vem do tipo do título no Omie (mapa lá em cima).
                const registro: any = {
                  id, origem: "omie", numero, codigo: "RB-" + String(numero).padStart(4, "0"),
                  vendaId, tipo: "parcela", parcelaN: null, valor, data: dataPagto,
                  forma: FORMA[d.cTipo] || "Boleto", obs: "baixa automática do Omie" +
                    (d.cNumBoleto ? " · boleto " + d.cNumBoleto : ""),
                  conferir: !vendaId || undefined,
                  omie: { titulo: d.nCodTitulo, venc: brParaISO(d.dDtVenc), cpf, parcela: d.cNumParcela || "" },
                  criadoEm: agora(), criadoPor: "omie",
                };
                if (!vendaId) registro.obsConferir = "não achei a venda deste CPF — vincular à mão";
                await guardarIndiceNumero("rec", numero, id);
                gravar.push({ colecao: "rec", id, registro });
                recPorId.set(id, registro);
                soma(vendaId ? "recNovos" : "recParaConferir");
              } else if (existente && !existente.apagadoEm) {
                // O título deixou de estar RECEBIDO (estorno/cancelamento lá).
                const morto = {
                  ...existente, apagadoEm: agora(), apagadoPor: "omie",
                  historico: [...(existente.historico || []),
                    { em: agora(), por: "omie", acao: "estornado no Omie (título " + d.cStatus + ")" }],
                };
                gravar.push({ colecao: "rec", id, registro: morto });
                soma("recEstornados");
              }
              continue;
            }

            /* despesa paga */
            if (grupo === "CONTA_A_PAGAR" && d.cStatus === "PAGO" && res.cLiquidado === "S") {
              const id = "cxomie-" + d.nCodTitulo;
              const jaCx = cxPorId.get(id);
              if (jaCx && !jaCx.apagadoEm) { soma("cxJaEspelhado"); continue; }
              const valor = Number(res.nValPago) || Number(d.nValorTitulo) || 0;
              const dataPagto = brParaISO(d.dDtPagamento);
              if (jaCx && jaCx.apagadoEm && jaCx.apagadoPor !== "omie") {
                // Despesa que o dono excluiu de propósito não volta da lixeira.
                if (centavos(jaCx.valor) !== centavos(valor)) {
                  pendNovas.push({ titulo: d.nCodTitulo, valor, data: dataPagto,
                    categoria: "despesa apagada na lixeira aqui — o valor no Omie difere",
                    categoriaOmie: d.cCodCateg || "" });
                }
                soma("cxNaLixeira"); continue;
              }
              const chaveDia = centavos(valor) + "|" + dataPagto;
              const chaveMes = centavos(valor) + "|" + dataPagto.slice(0, 7);
              const tidCx = String(d.nCodTitulo);
              if (tidsCobertos.has(tidCx)) { soma("cxJaNaPlanilha"); continue; }
              if (consome(saidasDia, chaveDia)) {
                // A mesma linha manual alimentou os dois mapas: gasta os dois.
                consome(saidasMes, chaveMes);
                tidsCobertos.add(tidCx);
                soma("cxJaNaPlanilha"); continue;
              }
              const categoria = categoriaLocal(d.cCodCateg || "");
              const fornecedorCpf = soDigitos(d.cCPFCNPJCliente);
              if (consome(saidasMes, chaveMes)) {
                tidsCobertos.add(tidCx);
                // Mesmo valor no mesmo mês com outro dia: pode ser o mesmo gasto
                // anotado noutra data OU um gasto irmão. Ninguém decide no escuro.
                pendNovas.push({ titulo: d.nCodTitulo, valor, data: dataPagto, categoria,
                  categoriaOmie: d.cCodCateg || "" });
                soma("cxDuvidosos");
                continue;
              }
              const registro: any = {
                id, origem: "omie", tipo: "saida", valor, data: dataPagto,
                forma: FORMA[d.cTipo] || "Transferência",
                categoria, descricao: "despesa do Omie (" + (d.cCodCateg || "sem categoria") + ")",
                omie: { titulo: d.nCodTitulo, categoria: d.cCodCateg || "" },
                criadoEm: agora(), criadoPor: "omie",
              };
              const corretorId = categoria === "Comissão" ? corretorPorDoc.get(fornecedorCpf) : "";
              if (corretorId) registro.corretorId = corretorId;
              gravar.push({ colecao: "cx", id, registro });
              cxPorId.set(id, registro);
              // NÃO entra no dedupe: título do Omie nunca duplica outro título
              // (tids distintos) — o dedupe é só contra lançamento manual, e
              // marcá-lo aqui pulava despesas gêmeas legítimas do mesmo dia.
              soma("cxNovos");
            }
          }
          if (pagina >= totPaginas) { pagina = 0; break; }   // acabou
          pagina += 1;
        }

        // aplica o espelho nas vendas tocadas nesta chamada (merge por tid;
        // trava do Léo vence em vencimento/valores; o PAGAMENTO real do banco
        // sempre atualiza — inclusive o estorno; parcela manual sem tid fica)
        // tids TRAVADOS em OUTRA venda (o Léo moveu a parcela): a sync nunca
        // recria a parcela na venda errada, mas o fato do pagamento é
        // REDIRECIONADO para onde a parcela mora (fila `redirecionados`).
        const vendasCache = new Map<string, any>();
        const lerVendaC = async (id2: string) => {
          if (!vendasCache.has(id2)) vendasCache.set(id2, await lerUm("venda", id2));
          return vendasCache.get(id2);
        };
        const travadosDoCpf = async (cpf2: string, foraDe: string) => {
          const m = new Map<string, string>();       // tid → venda onde a trava mora
          for (const vv of (vendasPorCpf.get(cpf2) || [])) {
            if (vv.id === foraDe) continue;
            const reg = await lerVendaC(vv.id);
            for (const pz of (reg?.parcelas || [])) if (pz && pz.tid && pz.trava) m.set(String(pz.tid), vv.id);
          }
          return m;
        };
        const redirecionados: { vendaId: string; it: any }[] = [];
        // Estorno em parcela travada: o dinheiro voltou no banco — o fato de
        // pagamento se desfaz mesmo com trava, e a parcela pede conferência.
        // Quem pagou a parcela: carimbo, ou dedução para as antigas sem ele
        // (travada = mexida por gente; sem trava, quem pagava era o sync).
        const origemDoPago = (p: any): string => p.pagoOrigem || (p.trava ? "manual" : "omie");
        const aplicarPagoNaTravada = (p: any, it: any): boolean => {
          if ((p.pago ?? null) === (it.pago ?? null) && (p.pagoValor ?? null) === (it.pagoValor ?? null)) return false;
          if (p.pago && !it.pago) {
            // Título em aberto no Omie mas parcela paga aqui: se a baixa foi
            // MANUAL (dinheiro por fora do boleto), não é estorno — fica.
            if (origemDoPago(p) !== "omie") return false;
            p.conferir = true;   // estorno real: o dinheiro voltou no banco
          }
          p.pago = it.pago ?? null;
          p.pagoValor = it.pagoValor ?? null;
          p.pagoOrigem = it.pago ? "omie" : null;
          return true;
        };
        const marcarCancelada = (p: any): void => {
          p.conferir = true;
          if (!String(p.obs || "").includes("cancelado no Omie")) {
            p.obs = p.obs ? p.obs + " · cancelado no Omie" : "cancelado no Omie";
          }
        };
        for (const [vId, itens] of titulosPorVenda) {
          const venda = await lerVendaC(vId);
          if (!venda || venda.apagadoEm) continue;
          const travadosFora = await travadosDoCpf(soDigitos(venda.clienteId), vId);
          const itensValidos: any[] = [];
          for (const it of itens) {
            const la = travadosFora.get(String(it.tid));
            if (la) redirecionados.push({ vendaId: la, it });   // o pagamento segue a parcela
            else itensValidos.push(it);
          }
          const atuais: any[] = Array.isArray(venda.parcelas) ? venda.parcelas.filter(Boolean) : [];
          const porTid = new Map(atuais.filter((x) => x.tid).map((x) => [String(x.tid), x]));
          for (const it of itensValidos) {
            const velho = porTid.get(String(it.tid));
            if (it.cancelado) {
              // Título CANCELADO no Omie: sai do espelho. Parcela travada não
              // some sozinha — fica marcada para o humano decidir.
              if (velho && velho.trava) marcarCancelada(velho);
              else if (velho) porTid.delete(String(it.tid));
              continue;
            }
            if (velho && velho.trava) {
              aplicarPagoNaTravada(velho, it);
            } else if (velho) {
              if (velho.pago && !it.pago && origemDoPago(velho) !== "omie") {
                // baixa manual em parcela sem trava: agenda atualiza, pago fica
                const { pago: _p, pagoValor: _pv, pagoOrigem: _po, ...agenda } = it;
                Object.assign(velho, agenda, { obs: velho.obs || "" });
              } else {
                Object.assign(velho, it, { obs: velho.obs || "" });
              }
            } else {
              porTid.set(String(it.tid), { ...it, origem: "omie" });
            }
          }
          const manuais = atuais.filter((x) => !x.tid);
          const novas = [...porTid.values(), ...manuais]
            .sort((x, y) => String(x.venc || "").localeCompare(String(y.venc || "")));
          venda.parcelas = novas;
          venda.atualizadoEm = agora();
          await gravarUm("venda", vId, venda);
          soma("vendasEspelhadas");
        }
        // Entrega o pagamento (ou o cancelamento) à parcela travada que mora
        // em OUTRA venda — a trava continua mandando em venc/valor.
        for (const { vendaId, it } of redirecionados) {
          const venda = await lerVendaC(vendaId);
          if (!venda || venda.apagadoEm) continue;
          const alvo = (venda.parcelas || []).find((pz: any) => pz && String(pz.tid) === String(it.tid) && pz.trava);
          if (!alvo) continue;
          let mudou = false;
          if (it.cancelado) {
            if (!String(alvo.obs || "").includes("cancelado no Omie")) { marcarCancelada(alvo); mudou = true; }
          } else {
            mudou = aplicarPagoNaTravada(alvo, it);
          }
          if (!mudou) continue;
          venda.atualizadoEm = agora();
          await gravarUm("venda", vendaId, venda);
          soma("pagamentosEmParcelaMovida");
        }
        if (titulosPorVenda.size) await marcarMudanca("venda");

        if (gravar.length) {
          await gravarVarios(gravar);
          await marcarMudanca([...new Set(gravar.map((g) => g.colecao))]);
        }

        const terminou = pagina === 0;
        const pendAntes: any[] = (body.pagina && body.pagina > 1 && meta?.pendenciasParciais) || [];
        const pendTotal = [...pendAntes, ...pendNovas];
        if (terminou) {
          // Pendência não pode morrer calada: a rodada COMPLETA revê tudo e
          // substitui a lista; a incremental só ACRESCENTA (união por título).
          // Some a que já virou lançamento (o cxomie- dela existe vivo).
          let pendFinal = pendTotal;
          if (!completa) {
            const antigas = (meta?.pendencias || []).filter((a: any) =>
              !pendTotal.some((n: any) => n.titulo === a.titulo));
            pendFinal = [...antigas, ...pendTotal];
          }
          pendFinal = pendFinal.filter((pnd: any) => {
            const cx = cxPorId.get("cxomie-" + pnd.titulo);
            return !cx || cx.apagadoEm;
          });
          await gravarMeta("omie_sync", {
            quando: agora(), por, completa, corte, contagens: cont,
            pendencias: pendFinal.slice(0, 60),
          });
          await registrarLog({ acao: "sincronizou com o Omie", por, ...cont });
          // Faxina: a tela de conferência foi removida do produto (25/08) — o
          // agregado que ela usava não precisa mais viver no banco.
          try { await db.from("bsq_meta").delete().eq("chave", "omie_conferencia"); } catch { /* best-effort */ }
        } else {
          // Rodada no meio: pendências parciais viajam pela meta para não se perderem.
          await gravarMeta("omie_sync", { ...(meta || {}), pendenciasParciais: pendTotal.slice(0, 60) });
        }
        return json({ ok: true, continua: terminou ? null : pagina, contagens: cont,
          pendencias: terminou ? pendTotal.slice(0, 60) : undefined });
      }

      /* ── saldos: quanto tem em cada conta, segundo o Omie ────────────────── */
      // O saldo vem do extrato do dia (nSaldoAtual). Carência de 30 minutos no
      // servidor para o Caixa poder perguntar sempre sem martelar o Omie.
      case "saldos": {
        const meta = await lerMeta("omie_saldos");
        if (!body.forcar && meta?.quando &&
            Date.now() - new Date(meta.quando).getTime() < 30 * 60e3) {
          return json({ ok: true, ...meta, cache: true });
        }
        const hojeBR = isoParaBR(diaBrasil());
        const r = await omie("geral/contacorrente", "ListarContasCorrentes",
          { pagina: 1, registros_por_pagina: 50 });
        const contas: any[] = [];
        for (const cc of (r.ListarContasCorrentes || [])) {
          if (cc.inativo === "S") continue;
          try {
            const ex = await omie("financas/extrato", "ListarExtrato",
              { nCodCC: cc.nCodCC, dPeriodoInicial: hojeBR, dPeriodoFinal: hojeBR });
            contas.push({ nome: cc.descricao || "", tipo: cc.tipo || "", saldo: Number(ex.nSaldoAtual) || 0 });
          } catch {
            contas.push({ nome: cc.descricao || "", tipo: cc.tipo || "", saldo: null });
          }
        }
        // O número do painel: só conta bancária de verdade (tipo CC), viva de
        // nome e de fato. "Caixinha" e afins ficam no detalhe, não no painel.
        const bancario = contas
          .filter((c) => c.tipo === "CC" && !/inativ/i.test(c.nome) && c.saldo != null)
          .reduce((soma, c) => soma + c.saldo, 0);
        // Alguma conta falhou (rate limit do Omie devolve 500): o total está
        // incompleto — responde com a flag `parcial` e NÃO grava o cache de
        // 30 min, senão o número errado fica pregado no painel do Caixa.
        const parcial = contas.some((c) => c.saldo == null);
        const novo: any = { quando: agora(), contas, bancario };
        if (parcial) novo.parcial = true;
        else await gravarMeta("omie_saldos", novo);
        return json({ ok: true, ...novo });
      }

      /* ── boleto: os títulos em aberto de um cliente, na hora ─────────────── */
      case "boleto": {
        const cpf = soDigitos(body.cpf);
        if (cpf.length < 11) return json({ error: "CPF inválido" }, 400);
        const mapa = (await lerMeta("omie_clientes"))?.mapaCpf || {};
        const codigo = mapa[cpf];
        if (!codigo) return json({ ok: true, titulos: [], aviso: "Cliente sem cadastro no Omie (ou sincronize primeiro)." });
        const abertos: any[] = [];
        let pagina = 1;
        while (pagina <= 3) {
          const r = await omie("financas/pesquisartitulos", "PesquisarLancamentos",
            { nPagina: pagina, nRegPorPagina: 100, nCodCliente: codigo, cNatureza: "R" });
          for (const t of r.titulosEncontrados || []) {
            const cab = t.cabecTitulo || {}; const res = t.resumo || {};
            // Cinto e suspensório: mesmo filtrado, confere o dono.
            if (cab.nCodCliente !== codigo) continue;
            if (res.cLiquidado === "S" || cab.cStatus === "CANCELADO") continue;
            if (!(Number(res.nValAberto) > 0)) continue;
            abertos.push({
              venc: brParaISO(cab.dDtVenc), valor: Number(cab.nValorTitulo) || 0,
              aberto: Number(res.nValAberto) || 0, status: cab.cStatus || "",
              parcela: cab.cNumParcela || "", boleto: cab.cNumBoleto || "",
              linhaDigitavel: cab.cCodigoBarras || "",
            });
          }
          if (pagina >= (r.nTotPaginas || 1)) break;
          pagina += 1;
        }
        abertos.sort((a, b) => a.venc.localeCompare(b.venc));
        return json({ ok: true, titulos: abertos.slice(0, 8) });
      }

      default:
        return json({ error: "Ação desconhecida: " + action }, 400);
    }
  } catch (e) {
    console.error("bsq-omie", action, e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
