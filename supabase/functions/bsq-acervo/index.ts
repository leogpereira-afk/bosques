// ============================================================================
// Edge Function "bsq-acervo" — arquivos grandes (contrato assinado, distrato,
// comprovante de pagamento, PDF de proposta).
//
// Mesmo protocolo em partes da Domo (iniciar → parte → finalizar →
// baixarParte), provado no 4G. As partes viram objetos no bucket
// "bsq-arquivos" do Storage:
//   <id>/meta   → metadados (coleção interna "_arqmeta")
//   <id>/p0, p1 → os pedaços
// ============================================================================
import { json, preflight } from "../_shared/cors.ts";
import { identificar, perfilDe, podeFazer } from "../_shared/acesso.ts";
import { COLECOES, NOMES_COLECOES } from "../_shared/colecoes.ts";
import { arquivosDoRegistro } from "../_shared/arquivos.ts";
import {
  agora, idNovo, lerUm, gravarUm, lerCfgBruta, lerTudo, registrarLog,
  subirParte, baixarParte, apagarArquivo, apagarDeVez, lerColecaoBruta,
} from "../_shared/dados.ts";

const META = "_arqmeta";

// A senha aberta demais vira chave-mestra do acervo: a régua de LEITURA vale
// por arquivo. Direção e escritório leem tudo (contratos são o trabalho
// deles); o corretor só baixa o que é de proposta DELE.
async function podeBaixar(eu: any, arquivoId: string, meta: any): Promise<boolean> {
  const perfil = perfilDe(eu);
  if (perfil === "direcao" || perfil === "escritorio") return true;
  const registros = await lerTudo(null, NOMES_COLECOES);
  // lerTudo vem SEM ordem garantida: decidir pelo primeiro registro que
  // referencia o arquivo dava resultado instável (negava download legítimo ou
  // soltava arquivo proibido, conforme a linha que viesse antes). Varre TODAS
  // as referências e concede se ALGUMA for visível ao papel.
  let dePropostaDele = false;
  for (const o of registros) {
    if (!arquivosDoRegistro(o).includes(arquivoId)) continue;
    if (o._col === "foto") return true;               // apresentação: material de venda
    if (o._col === "prop" && o.dono === eu.id) dePropostaDele = true;
  }
  // Arquivo órfão: ninguém abre por aqui (direção/escritório já saíram acima).
  if (!dePropostaDele) return false;
  // O anexo da proposta é gravável pelo PRÓPRIO corretor: a referência só vale
  // para arquivo que ele mesmo subiu — senão anexar um arquivoId alheio à
  // própria proposta abriria contrato/comprovante que o perfil proíbe.
  if (meta && meta.criadoPorId) return meta.criadoPorId === eu.id;
  // Arquivos antigos não têm o id do criador: compara o nome carimbado no
  // envio (para acesso próprio o servidor força quem = eu.nome).
  return !!(meta && meta.criadoPor && eu.proprio && eu.nome && meta.criadoPor === eu.nome);
}

const b64ParaBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesParaB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const h = Object.fromEntries(req.headers);
  const TOKEN = Deno.env.get("BSQ_TOKEN");
  if (!TOKEN || (h["x-token"] || body.token) !== TOKEN) return json({ error: "Não autorizado" }, 401);

  const cfg = await lerCfgBruta();
  const eu = await identificar(cfg, h["x-senha"] || body.senha || "");
  if (!eu) return json({ error: "Senha inválida", semSenha: true }, 403);

  // 'uso' segue a régua do nucleo. 'apagar' AQUI é destruição definitiva no
  // Storage (arquivo não tem lixeira) — régua de direção, a mesma do
  // esvaziarLixeira; o 'apagar' comum do nucleo é lixeira restaurável.
  const ACAO_EQUIVALENTE: Record<string, string> = { apagar: "esvaziarLixeira", uso: "log" };
  const equivalente = ACAO_EQUIVALENTE[body.action];
  if (equivalente && !podeFazer(eu, equivalente)) {
    return json({ error: "Seu acesso não permite isso. Fale com a direção.", semPermissao: true }, 403);
  }

  const quem = (eu.proprio && eu.nome) ||
    String(h["x-quem"] ? decodeURIComponent(h["x-quem"]) : (body.por || "—")).slice(0, 60);

  try {
    switch (body.action) {

      case "iniciar": {
        const id = idNovo() + Math.random().toString(36).slice(2, 6);
        const meta = {
          id,
          nome: String(body.nome || "arquivo").slice(0, 200),
          // O cliente manda o tipo no campo 'mime' (lição paga no porte da
          // Domo: ler outro nome de campo gravava tudo como octet-stream).
          mime: String(body.mime ?? body.tipo ?? "application/octet-stream").slice(0, 100),
          tamanho: Number(body.tamanho) || 0,
          partes: Math.max(1, Number(body.partes) || 1),
          recebidas: 0,
          criadoEm: agora(),
          criadoPor: quem,
          // id manda, nome só exibe: a régua de download do corretor
          // (podeBaixar) compara por este id, não pelo nome.
          criadoPorId: (eu.proprio && eu.id) || "",
          pronto: false,
        };
        await gravarUm(META, id, meta);
        return json({ ok: true, id, meta });
      }

      case "parte": {
        const { id, dados } = body;
        const idx = Number(body.i ?? body.n);
        if (!Number.isInteger(idx) || idx < 0) return json({ ok: false, error: "Índice de parte inválido" }, 400);
        const meta = await lerUm(META, id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        // Arquivo finalizado não aceita pedaço novo (sobrescrever contrato
        // aprovado com lixo, em silêncio, não).
        if (meta.pronto) return json({ ok: false, error: "Arquivo já finalizado" }, 409);
        if (perfilDe(eu) !== "direcao" && meta.criadoPor && meta.criadoPor !== quem) {
          return json({ ok: false, error: "Este envio é de outra pessoa", semPermissao: true }, 403);
        }
        if (typeof dados !== "string") return json({ ok: false, error: "Parte vazia" }, 400);
        await subirParte(id + "/p" + idx, b64ParaBytes(dados));
        meta.recebidas = Math.max(Number(meta.recebidas) || 0, idx + 1);
        await gravarUm(META, id, meta);
        return json({ ok: true, recebidas: meta.recebidas, partes: meta.partes });
      }

      case "finalizar": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        // Confere pedaço por pedaço no Storage: contador certo com parte que
        // não subiu deixaria o arquivo "pronto" e corrompido.
        for (let i = 0; i < (meta.partes || 1); i++) {
          const p = await baixarParte(body.id + "/p" + i);
          if (!p) return json({ ok: false, error: "Falta a parte " + i + " de " + meta.partes }, 400);
        }
        meta.pronto = true;
        meta.concluidoEm = agora();
        await gravarUm(META, body.id, meta);
        return json({ ok: true, meta });
      }

      case "meta": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (!await podeBaixar(eu, body.id, meta)) {
          return json({ error: "Seu acesso não permite este arquivo.", semPermissao: true }, 403);
        }
        return json({ ok: true, meta });
      }

      case "baixarParte": {
        const idx = Number(body.i ?? body.n);
        if (!Number.isInteger(idx) || idx < 0) return json({ ok: false, error: "Índice de parte inválido" }, 400);
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (!await podeBaixar(eu, body.id, meta)) {
          return json({ error: "Seu acesso não permite este arquivo.", semPermissao: true }, 403);
        }
        const bytes = await baixarParte(body.id + "/p" + idx);
        if (!bytes) return json({ ok: false, error: "Parte não encontrada" }, 404);
        return json({ ok: true, dados: bytesParaB64(bytes), partes: meta.partes, meta });
      }

      case "apagar": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: true });
        // Não há lixeira de arquivo: apagar aqui é irreversível. Registro VIVO
        // ainda apontando para o arquivo viraria download 404 — recusa; o
        // caminho certo é apagar o registro (lixeira do nucleo cuida do resto).
        const registros = await lerTudo(null, NOMES_COLECOES);
        const vivo = registros.find((o: any) => !o.apagadoEm && arquivosDoRegistro(o).includes(body.id));
        if (vivo) {
          const nomeCol = (COLECOES[vivo._col] && COLECOES[vivo._col].nome) || vivo._col;
          return json({ ok: false, emUso: true, error: "Arquivo em uso por registro vivo (" + nomeCol + ") — apague o registro primeiro." }, 409);
        }
        const chaves: string[] = [];
        for (let i = 0; i < (meta.partes || 1); i++) chaves.push(body.id + "/p" + i);
        await apagarArquivo(chaves);
        await apagarDeVez(META, body.id);
        // Destruição definitiva fica no histórico, como as ações do nucleo.
        await registrarLog({ acao: "apagou arquivo do acervo", por: quem, id: body.id, nome: meta.nome, tamanho: meta.tamanho });
        return json({ ok: true });
      }

      case "uso": {
        const linhas = await lerColecaoBruta(META, "registro");
        let bytes = 0, arquivos = 0;
        for (const l of linhas) {
          const m = l.registro as any;
          if (!m || !m.pronto) continue;
          bytes += Number(m.tamanho) || 0;
          arquivos++;
        }
        return json({ ok: true, arquivos, bytes });
      }

      default:
        return json({ error: "Ação desconhecida: " + body.action }, 400);
    }
  } catch (e) {
    console.error("[bsq-acervo] erro:", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
