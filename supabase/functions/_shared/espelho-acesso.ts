// A senha compartilhada só libera o espelho. Nunca autentica no painel interno.
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
const aleatorio = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const iguais = (a: string,b: string) => {if(a.length!==b.length)return false;let dif=0;for(let i=0;i<a.length;i++)dif|=a.charCodeAt(i)^b.charCodeAt(i);return dif===0;};
async function derivar(cliente: string,sal: string) {
  const chave=await crypto.subtle.importKey('raw',enc.encode(cliente),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(sal),iterations:100000},chave,256));
}
export async function novaSenhaEspelho(cliente: string) {
  if(!/^[a-f0-9]{64}$/.test(cliente))throw Error('Senha inválida');
  const sal=aleatorio();return {sal,hash:await derivar(cliente,sal),chave:aleatorio()};
}
export async function senhaEspelhoConfere(cliente: unknown,acesso: any) {
  if(!acesso?.hash||!acesso?.sal||!/^[a-f0-9]{64}$/.test(String(cliente)))return false;
  return iguais(await derivar(String(cliente),acesso.sal),acesso.hash);
}
export function cadastroEspelho(body: any) {
  const nome=String(body?.nome||'').trim().replace(/\s+/g,' ');
  let telefone=String(body?.telefone||'').replace(/\D/g,'');
  if(telefone.startsWith('55')&&telefone.length>11)telefone=telefone.slice(2);
  if(nome.length<2||nome.length>100||!/[a-zÀ-ÿ]/i.test(nome))throw Error('Informe seu nome.');
  if(!/^[1-9]{2}\d{8,9}$/.test(telefone))throw Error('Informe um telefone válido com DDD.');
  const perfil=String(body?.perfil||'');
  if(!['corretor','cliente','outro'].includes(perfil))throw Error('Informe se você é corretor, cliente ou outro.');
  return {nome,telefone,perfil};
}
const b64 = (s: string) => btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function assinatura(s: string,chave: string) {
  const k=await crypto.subtle.importKey('raw',enc.encode(chave),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',k,enc.encode(s)));
}
export async function sessaoEspelho(id: string,cfg: any,agora=Date.now()) {
  const dados=b64(JSON.stringify({id,exp:agora+8*60*60*1000}));
  return dados+'.'+await assinatura(dados+'|'+cfg.espelhoToken,cfg.espelhoAcesso.chave);
}
export async function validarSessaoEspelho(token: string,cfg: any,agora=Date.now()): Promise<string|null> {
  try {
    if(!cfg?.espelhoAcesso?.chave||token.length>1000)return null;
    const [dados,sig,extra]=token.split('.');if(extra||!dados||!sig)return null;
    if(!iguais(sig,await assinatura(dados+'|'+cfg.espelhoToken,cfg.espelhoAcesso.chave)))return null;
    const j=JSON.parse(atob(dados.replace(/-/g,'+').replace(/_/g,'/')));
    return /^[a-f0-9]{64}$/.test(j.id)&&Number.isFinite(j.exp)&&j.exp>agora?j.id:null;
  }catch{return null;}
}
// Limita tentativas em cada instância, antes da derivação de senha.
const tentativas = new Map<string,{n:number,ate:number}>();
export function tentativaEspelho(ip: string,agora=Date.now()) {
  for(const [k,v] of tentativas)if(v.ate<=agora)tentativas.delete(k);
  const t=tentativas.get(ip)||{n:0,ate:agora+10*60*1000};
  if(tentativas.size>=2000&&!tentativas.has(ip))return false;
  t.n++;tentativas.set(ip,t);return t.n<=10;
}
