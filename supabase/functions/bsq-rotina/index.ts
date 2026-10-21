// ============================================================================
// Supabase Edge Function "rotina" — o que o cron do Netlify fazia todo dia.
//
// Chamada pelo pg_cron (@daily, 06:00 UTC ≈ 03:00 em Montes Claros), com um
// segredo próprio no header. Faz, em ordem:
//   1. cópia de segurança do dia (tabela backup, 60 dias de histórico)
//   2. apaga backups com mais de 60 dias
//   3. apaga log com mais de 120 dias
//   4. esvazia a lixeira do que foi apagado há mais de 90 dias
//   5. remove arquivo órfão (upload interrompido, registro apagado de vez)
//
// Backup automático sem depender de ninguém apertar botão.
// ============================================================================
import { json } from "../_shared/cors.ts";
import { NOMES_COLECOES } from "../_shared/colecoes.ts";
import { cfgSemSegredo } from "../_shared/acesso.ts";
import { arquivosDoRegistro } from "../_shared/arquivos.ts";
import { lapideDe, precisaLapide } from "../_shared/lixeira.ts";
import {
  db,
  agora,
  lerUm,
  lerTudo,
  lerCfgBruta,
  lerNumeracao,
  gravarBackup,
  apagarArquivo,
  apagarDeVez,
  gravarUm,
  registrarLog,
  lerColecaoBruta,
  lerApagados,
} from "../_shared/dados.ts";

const DIAS_BACKUP = 60;
const DIAS_LOG = 120;
const DIAS_LIXEIRA = 90;
const META = "_arqmeta";

const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

// Cloudflare pode devolver uma página HTML em uma indisponibilidade da API.
// Preserve a causa no status sem gravar a página inteira e truncar os logs.
function mensagemErro(erro: unknown): string {
  const texto = (erro as Error)?.message || String(erro);
  const titulo = texto.match(/<title>([^<]+)<\/title>/i);
  return (titulo ? (texto.split("<!DOCTYPE")[0].split("<html")[0].slice(0, 80) + titulo[1]) : texto).slice(0, 500);
}

function falhaTransitoria(erro: unknown): boolean {
  const e = erro as { status?: number; statusCode?: number; message?: string };
  const status = Number(e?.status || e?.statusCode);
  if (status >= 500 && status <= 599) return true;
  const mensagem = e?.message || String(erro);
  return /\b(?:http|status(?: code)?|error code)\s*:?\s*5\d{2}\b|\|\s*5\d{2}\s*:|fetch failed|failed to fetch|network(?: error| request failed)|connection (?:reset|refused|error|closed)|econnreset|econnrefused|etimedout|socket hang up|\b(?:request |connection )?timed?\s*out\b|service unavailable|bad gateway|gateway timeout/i.test(mensagem);
}

// arquivosDoRegistro vem de _shared/arquivos.ts (cópia única). Antes esta cópia
// não conhecia anexos/asos, então o passo 5 (varredor de órfãos) apagava o PDF
// do ASO de um colaborador ATIVO ~1 dia depois do upload.

Deno.serve(async (req) => {
  // Roda sozinha, sem ninguém logado: a entrada é um segredo de serviço,
  // conferido aqui dentro (verify_jwt = false, igual às outras).
  const segredo = Deno.env.get("BSQ_ROTINA_TOKEN");
  const veio = req.headers.get("x-rotina-token") || new URL(req.url).searchParams.get("t");
  if (!segredo || veio !== segredo) return json({ error: "Não autorizado" }, 401);

  let corpo: { somenteBackup?: boolean } = {};
  try {
    const texto = await req.text();
    if (texto.trim()) {
      corpo = JSON.parse(texto);
      if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return json({ error: "Corpo inválido" }, 400);
    }
  } catch { return json({ error: "JSON inválido" }, 400); }
  if (Object.prototype.hasOwnProperty.call(corpo, "somenteBackup") && typeof corpo.somenteBackup !== "boolean") {
    return json({ error: "somenteBackup deve ser verdadeiro ou falso" }, 400);
  }
  const somenteBackup = corpo.somenteBackup === true;
  const hoje = agora().slice(0, 10);
  const resultado: Record<string, unknown> = { dia: hoje, ...(somenteBackup ? { somenteBackup: true } : {}) };

  async function concluir() {
    resultado.ok = !Object.keys(resultado).some((chave) => chave.startsWith("erro"));
    // Recuperar uma cópia não afirma que a manutenção completa foi executada.
    try {
      const { error } = await db.from("bsq_meta").upsert({
        chave: somenteBackup ? "backup_status" : "manutencao_status",
        valor: { em: agora(), ...resultado }, atualizado_em: agora(),
      });
      if (error) throw error;
    } catch (e) { resultado.erroStatus = mensagemErro(e); resultado.ok = false; }
    try {
      await registrarLog({ acao: somenteBackup ? "backup diário" : "rotina diária", por: "sistema", ...resultado });
    } catch (e) { resultado.erroLog = mensagemErro(e); resultado.ok = false; }
    console.log("[rotina]", JSON.stringify(resultado));
    return json(resultado, resultado.ok ? 200 : 503);
  }

  // 1. Cópia do dia. Só leituras e o upsert diário são repetíveis; nunca as
  // exclusões. Falha permanente ou três falhas transitórias impedem a limpeza.
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    resultado.backupTentativas = tentativa;
    try {
    // Cadastros de acesso são privados: entram no backup, não no snapshot do painel.
    const registros = await lerTudo(null, [...NOMES_COLECOES, "espelho_acesso"]);
    const cfg = await lerCfgBruta();
    // Nenhum hash de senha entra na cópia.
    const copia = cfgSemSegredo(cfg);
    // Sem a numeração, uma restauração recomeçaria em SC-0001 e repetiria
    // número de documento que já foi para fornecedor.
    const seq = await lerNumeracao();
    // Inventário dos arquivos: sem ele ninguém sabe quais plantas existiam.
    // Paginado: uma varredura sem .range() para em 1000 e o backup ficaria
    // incompleto sem avisar.
    const metas = await lerColecaoBruta(META, "registro");
    const arquivos = metas.map((l: any) => l.registro);

    await gravarBackup(hoje, { em: agora(), cfg: copia, registros, seq, arquivos });
    resultado.registros = registros.length;
    resultado.arquivos = arquivos.length;
    resultado.backupSalvo = true;
    break;
    } catch (e) {
      if (tentativa < 3 && falhaTransitoria(e)) {
        await new Promise((resolver) => setTimeout(resolver, 250 * tentativa));
        continue;
      }
      resultado.erroBackup = mensagemErro(e);
      break;
    }
  }
  if (!resultado.backupSalvo) {
    resultado.limpezasIgnoradas = true;
    return await concluir();
  }
  if (somenteBackup) return await concluir();

  // 2. Backups com mais de 60 dias
  try {
    const limite = diasAtras(DIAS_BACKUP).slice(0, 10);
    const { data, error } = await db.from("bsq_backup").delete().lt("dia", limite).select("dia");
    if (error) throw error;
    resultado.backupsApagados = (data || []).length;
  } catch (e) { resultado.erroLimpezaBackup = (e as Error)?.message || String(e); }

  // 3. Log antigo
  try {
    const { data, error } = await db.from("bsq_log").delete().lt("em", diasAtras(DIAS_LOG)).select("id");
    if (error) throw error;
    resultado.logApagado = (data || []).length;
  } catch (e) { resultado.erroLimpezaLog = (e as Error)?.message || String(e); }

  // 4. Lixeira: some de vez com o que foi apagado há mais de 90 dias, junto
  //    com os arquivos que só aquele registro usava.
  try {
    const limite = diasAtras(DIAS_LIXEIRA);
    // Coleta TUDO antes de apagar: paginar por offset enquanto se apaga da
    // mesma tabela pularia linhas (o conjunto encolhe sob o cursor).
    const data = await lerApagados();
    let apagados = 0, lapides = 0;
    for (const linha of data) {
      const o = linha.registro as any;
      if (!o.apagadoEm || o.apagadoEm >= limite || o.lapide) continue;
      for (const idArq of arquivosDoRegistro(o)) {
        const meta = await lerUm(META, idArq);
        const chaves: string[] = [];
        for (let i = 0; i < ((meta && meta.partes) || 1); i++) chaves.push(idArq + "/p" + i);
        await apagarArquivo(chaves);
        await apagarDeVez(META, idArq);
      }
      // Espelho do Omie apagado por uma pessoa fica como lápide (ver lixeira.ts).
      if (precisaLapide(linha.id, o)) { await gravarUm(linha.colecao, linha.id, lapideDe(o)); lapides++; continue; }
      await apagarDeVez(linha.colecao, linha.id);
      apagados++;
    }
    resultado.lixeiraApagada = apagados;
    if (lapides) resultado.lapides = lapides;
  } catch (e) { resultado.erroLixeira = (e as Error)?.message || String(e); }

  // 5. Arquivos órfãos: metadados que nenhum registro usa mais (upload
  //    interrompido, registro apagado de vez). Sem isso uma planta de 60MB fica
  //    ocupando espaço para sempre.
  try {
    // Cadastros de acesso são privados: entram no backup, não no snapshot do painel.
    const registros = await lerTudo(null, [...NOMES_COLECOES, "espelho_acesso"]);
    const usados = new Set<string>();
    for (const o of registros) for (const id of arquivosDoRegistro(o)) usados.add(id);

    const metas = await lerColecaoBruta(META, "id, registro");
    // Carência de 1 dia: arquivo recém-enviado pode estar esperando o registro
    // que ainda está na fila de um celular sem sinal.
    const ontem = diasAtras(1);
    let orfaos = 0;
    for (const l of metas) {
      const m = l.registro as any;
      if (usados.has(l.id)) continue;
      if (m && m.criadoEm && m.criadoEm > ontem) continue;
      const chaves: string[] = [];
      for (let i = 0; i < ((m && m.partes) || 1); i++) chaves.push(l.id + "/p" + i);
      await apagarArquivo(chaves);
      await apagarDeVez(META, l.id);
      orfaos++;
    }
    resultado.arquivosOrfaos = orfaos;
  } catch (e) { resultado.erroOrfaos = (e as Error)?.message || String(e); }

  // 6. Só anuncia sucesso após confirmar a gravação do batimento.
  return await concluir();
});
