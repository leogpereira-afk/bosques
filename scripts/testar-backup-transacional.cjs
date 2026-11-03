/* Backup SQL real em PostgreSQL/PGlite isolado. Apenas dados fictícios. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: [process.env.BSQ_TEST_DEPS, process.cwd()].filter(Boolean) }));
(async () => {
  const db = new PGlite(); let checks = 0;
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table bsq_registros(colecao text,id text,registro jsonb,apagado boolean default false,primary key(colecao,id));
    create table bsq_cfg(id boolean primary key,config jsonb);
    create table bsq_seq(colecao text,n int);
    create table bsq_backup(dia date primary key,conteudo jsonb,em timestamptz default now());
    insert into bsq_cfg values(true,'{"empresa":{"nome":"Teste"},"senhaHash":"privado","espelhoAcesso":{"hash":"privado"},"usuarios":[{"nome":"Pessoa teste","hash":"privado"}]}');
    insert into bsq_seq values('venda',1201),('rec',42);
    insert into bsq_registros select 'titulo',i::text,jsonb_build_object('id',i::text,'valor',100,'historico',jsonb_build_array('preservar')),false from generate_series(1,1201) i;
    insert into bsq_registros values('venda','v1','{"id":"v1","apagadoEm":"2026-01-01","parcelas":[{"valor":80}]}',true),
      ('colecao_futura','f1','{"id":"f1"}',false),('_arqmeta','pdf1','{"id":"pdf1","nome":"documento.pdf"}',false);
    insert into bsq_backup values('2001-01-01','{"historico":"intacto"}',now());
    grant select on bsq_registros,bsq_cfg,bsq_seq to service_role;
    grant select,insert,update on bsq_backup to service_role;`);
  const migration = fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_backup_transacional.sql'));
  await db.exec(fs.readFileSync(path.join('supabase/migrations',migration),'utf8'));
  const snapshot = async () => JSON.stringify((await db.query('select * from bsq_registros order by colecao,id')).rows);
  const before = await snapshot();
  await db.exec('set role service_role');
  const result = (await db.query('select bsq_criar_backup_diario() r')).rows[0].r;
  assert.equal(result.registros,1203); assert.equal(result.arquivos,1); checks++;
  let backup = (await db.query('select conteudo from bsq_backup where dia=$1',[result.dia])).rows[0].conteudo;
  assert.equal(backup.registros.length,1203); assert.ok(backup.registros.find(r=>r.apagadoEm)); assert.ok(backup.registros.find(r=>r._col==='colecao_futura')); checks++;
  assert.equal(backup.cfg.senhaHash,undefined);assert.equal(backup.cfg.espelhoAcesso,undefined);assert.equal(backup.cfg.usuarios[0].hash,undefined);assert.equal(backup.cfg.espelhoSenhaConfigurada,true); checks++;
  assert.equal(backup.seq.ultimo_venda.n,1201);assert.equal(backup.arquivos[0].id,'pdf1');checks++;
  assert.equal(await snapshot(),before);checks++;
  await db.query('select bsq_criar_backup_diario()');
  assert.equal((await db.query('select count(*)::int n from bsq_backup')).rows[0].n,2);checks++;
  assert.deepEqual((await db.query("select conteudo from bsq_backup where dia='2001-01-01'")).rows[0].conteudo,{historico:'intacto'});checks++;
  for (const role of ['anon','authenticated']) {
    await db.exec('reset role;set role '+role);
    await assert.rejects(db.query('select bsq_criar_backup_diario()'), /permission denied/);checks++;
  }
  await db.exec('reset role;delete from bsq_cfg');
  const safe = JSON.stringify((await db.query('select * from bsq_backup order by dia')).rows);
  await assert.rejects(db.query('select bsq_criar_backup_diario()'), /Configuração ausente/);
  assert.equal(JSON.stringify((await db.query('select * from bsq_backup order by dia')).rows),safe);checks++;
  await db.exec(`insert into bsq_cfg values(true,'{}');
    create function rejeitar_backup() returns trigger language plpgsql as $$begin raise exception 'Falha simulada';end$$;
    create trigger falha before insert or update on bsq_backup for each row execute function rejeitar_backup();`);
  await assert.rejects(db.query('select bsq_criar_backup_diario()'),/Falha simulada/);
  assert.equal(JSON.stringify((await db.query('select * from bsq_backup order by dia')).rows),safe);assert.equal(await snapshot(),before);checks++;
  console.log(`${checks} verificações PostgreSQL passaram: paginação, arquivo/lixeira/histórico, segredos, permissões, idempotência, rollback`);
  await db.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
