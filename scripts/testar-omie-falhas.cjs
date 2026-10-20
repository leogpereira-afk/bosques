// Falhas seguidas: o erro não some a cada tentativa, as tentativas são
// contadas desde a primeira falha e a espera cresce até 30 minutos.
const fs=require('fs'),assert=require('assert/strict');
const {PGlite}=require(process.env.BSQ_TEST_DEPS+'/node_modules/@electric-sql/pglite');
(async()=>{const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');
await db.exec(fs.readFileSync('supabase/migrations/202609060003_omie_automatico.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/202610200001_omie_falhas_seguidas.sql','utf8'));
const reservar=async(auto=true,completa=false)=>(await db.query('select bsq_omie_reservar($1,null,$2) r',[auto,completa])).rows[0].r;
const fim=async(s,pagina,erro=null)=>(await db.query("select bsq_omie_finalizar($1,$2,'{}',$3,$4) r",[s.lease,pagina,!!s.completa,erro])).rows[0].r;
const estado=async()=>(await db.query("select tentativas,falhando_desde,ultimo_erro,pagina,completa,inicio,round(extract(epoch from proxima-now())/60) as espera from bsq_omie_execucao")).rows[0];
const liberar=()=>db.exec("update bsq_omie_execucao set proxima=now()-interval '1 minute'");
// Rodada nova pedida como completa grava a marca; a retomada não troca a marca.
let s=await reservar(true,true);assert.equal(s.adquirido,true);assert.equal(s.completa,true);
await fim(s,4);await liberar();s=await reservar(true,false);assert.equal(s.completa,true,'retomada mantém a rodada completa');assert.equal(s.pagina,4);
// Falhas seguidas: 5, 10, 20, 30, 30 minutos; erro guardado entre tentativas.
const esperas=[];let primeiro=null;
for(let i=1;i<=5;i++){await fim(s,9,'Omie fora '+i);const e=await estado();esperas.push(Number(e.espera));assert.equal(e.tentativas,i);assert.equal(e.pagina,4,'erro não avança a página');
 if(i===1)primeiro=e.falhando_desde;else assert.equal(String(e.falhando_desde),String(primeiro),'falhando_desde fica na primeira falha');
 await liberar();s=await reservar();assert.equal(s.adquirido,true);assert.equal((await estado()).ultimo_erro,'Omie fora '+i,'reservar não apaga o erro');}
assert.deepEqual(esperas,[5,10,20,30,30]);
// Uma chamada que dá certo zera tudo, mesmo no meio da rodada.
await fim(s,6);let e=await estado();assert.equal(e.tentativas,0);assert.equal(e.falhando_desde,null);assert.equal(e.ultimo_erro,null);assert.equal(e.pagina,6);assert.equal(Number(e.espera),0);
// Fim da rodada: volta à página 1, sem marca de completa, próxima em 15 min.
await liberar();s=await reservar();await fim(s,0);e=await estado();assert.equal(e.pagina,1);assert.equal(e.completa,false);assert.equal(e.inicio,null);assert.equal(Number(e.espera),15);
// Rodada interrompida (função morta sem finalizar): a reserva vence e a tentativa seguinte retoma.
s=await reservar(false);await db.exec("update bsq_omie_execucao set reservado_ate=now()-interval '1 minute'");assert.equal((await reservar(false)).adquirido,true);
console.log('PASSOU: erro guardado entre tentativas, contagem desde a primeira falha, espera 5/10/20/30 min, sucesso zera, fim de rodada e retomada de rodada completa.');
await db.close();})().catch(e=>{console.error(e);process.exit(1)});
