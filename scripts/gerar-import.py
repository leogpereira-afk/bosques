#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Converte seed/*.json (extraídos da planilha) nos REGISTROS do sistema e
gera seed/importar.json — o corpo da ação 'restaurar' do bsq-nucleo.

Uso:  python3 scripts/gerar-import.py
Depois do deploy:  ./scripts/subir-import.sh  (pede a senha da direção)

Decisões de importação (cada uma escrita no CONFERIR.md):
  • CPF com 10 dígitos ganha o ZERO à esquerda que o Excel comeu — é isso que
    junta as duas linhas do Raphael e liga as vendas ao corretor certo.
  • Lote vendido DUAS VEZES na planilha: a venda mais antiga entra como
    "conferir" (provável distrato não registrado) e a mais nova como ativa.
    NINGUÉM é distratado por dedução — o botão é do Léo.
  • Entrada com data de recebimento vira RECEBIMENTO (o caixa nasce certo).
  • Comissão com data de pagamento vira SAÍDA de caixa categoria Comissão.
    Sem data = ainda devida (aparece no saldo do corretor).
  • Linha de anotação da planilha (valor na coluna E) NÃO entra: era dinheiro
    já contado em outra aba.
"""
import hashlib, json, re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SEED = RAIZ / 'seed'

def ler(nome):
    return json.loads((SEED / f'{nome}.json').read_text(encoding='utf-8'))

def cpf11(c):
    d = re.sub(r'\D', '', str(c or ''))
    return ('0' + d) if len(d) == 10 else d

def idNovo(pref, n):
    return f'{pref}{n:05d}'

def idHash(*partes):
    """Id ESTÁVEL entre reimportações: mesma linha da planilha → mesmo id.
    É o que faz o modo híbrido atualizar em vez de duplicar."""
    h = hashlib.sha1('|'.join(str(x) for x in partes).encode('utf-8')).hexdigest()[:12]
    return h

conferir = []
registros = []

# ── corretores (dedupe por CPF normalizado) ─────────────────────────────────
corretores = {}
for c in ler('corretores'):
    cid = cpf11(c['cpf']) or re.sub(r'\W', '', c['nome'].lower())[:20]
    if cid in corretores:
        conferir.append(f"Corretor duplicado juntado: {c['nome']} (CPF {cid})")
        # completa campos vazios com a segunda linha
        for k, v in c.items():
            if v and not corretores[cid].get(k):
                corretores[cid][k] = v
        continue
    corretores[cid] = { 'id': cid, **c, 'cpf': cpf11(c['cpf']), 'ativo': True, 'origem': 'planilha' }
for c in corretores.values():
    registros.append({ **c, '_col': 'corretor' })

# ── clientes ─────────────────────────────────────────────────────────────────
clientes = {}
for c in ler('clientes'):
    cid = cpf11(c['cpf']) or re.sub(r'\W', '', c['nome'].lower())[:24]
    if cid in clientes:
        for k, v in c.items():
            if v and not clientes[cid].get(k):
                clientes[cid][k] = v
        continue
    clientes[cid] = { 'id': cid, **c, 'cpf': cpf11(c['cpf']), 'origem': 'planilha' }
for c in clientes.values():
    registros.append({ **c, '_col': 'cliente' })

# ── vendas (com a regra do lote vendido 2x) ──────────────────────────────────
vendas = ler('vendas')
por_lote = {}
for v in vendas:
    por_lote.setdefault(v['loteId'], []).append(v)

vendas_out = []
n = 0
for v in vendas:
    n += 1
    grupo = por_lote[v['loteId']]
    situacao = 'ativa'
    if len(grupo) > 1:
        # a mais NOVA (pela data da entrada) fica ativa; as demais, "conferir"
        datas = sorted(g['dataEntrada'] or g['dataVenda'] or '' for g in grupo)
        minha = v['dataEntrada'] or v['dataVenda'] or ''
        if minha != datas[-1] or [g['dataEntrada'] or g['dataVenda'] or '' for g in grupo].count(minha) > 1 and grupo.index(v) < len(grupo) - 1:
            situacao = 'conferir'
    corId = cpf11(v['corretorCpf'])
    if corId and corId not in corretores:
        conferir.append(f"Venda {v['loteId']}: corretor CPF {corId} ({v['corretorNome']}) fora do cadastro")
    cliId = cpf11(v['clienteCpf']) or re.sub(r'\W', '', (v['clienteNome'] or '').lower())[:24]
    if cliId not in clientes:
        clientes[cliId] = { 'id': cliId, 'cpf': cpf11(v['clienteCpf']), 'nome': v['clienteNome'], 'origem': 'planilha' }
        registros.append({ **clientes[cliId], '_col': 'cliente' })
        conferir.append(f"Cliente criado só com a venda: {v['clienteNome']}")
    venda = {
        '_col': 'venda',
        'id': 'vd-' + v['loteId'] + '-' + (cliId or 'x'),
        'origem': 'planilha',
        'numero': n, 'codigo': f'VD-{n:04d}',
        'loteId': v['loteId'], 'quadra': v['quadra'], 'lote': v['lote'],
        'clienteId': cliId, 'clienteNome': v['clienteNome'],
        'corretorId': corId, 'corretorNome': v['corretorNome'],
        'comissao': v['comissao'] or 0,
        'dataVenda': v['dataVenda'] or v['dataEntrada'],
        'entrada': v['entrada'] or 0, 'formaEntrada': v['formaEntrada'],
        'dataEntrada': v['dataEntrada'],
        'qtdeParcelas': v['qtdeParcelas'], 'valorParcela': v['valorParcela'] or 0,
        'tipoParcela': v['tipoParcela'], 'inicioParcelas': v['inicioParcelas'],
        'situacao': situacao,
        'obs': v['obs'] or '',
        'criadoEm': (v['dataEntrada'] or '2026-03-01') + 'T12:00:00.000Z',
        'criadoPor': 'importação da planilha',
        'historico': [{ 'id': 'imp' + str(n), 'em': '2026-08-21T12:00:00.000Z',
                        'por': 'importação', 'o_que': 'Venda importada da planilha GerenciadorLoteamento' +
                        (' — MARCADA PARA CONFERIR (lote vendido 2x na planilha)' if situacao == 'conferir' else '') }],
    }
    if situacao == 'conferir':
        conferir.append(f"CONFERIR na tela: {venda['codigo']} Q{v['quadra']}-L{v['lote']} {v['clienteNome']} — "
                        f"o lote foi vendido de novo depois; se esta caiu, use o botão Distratar")
    if not v['dataEntrada'] and not v['inicioParcelas']:
        conferir.append(f"Venda sem data de entrada NEM de início das parcelas: {venda['codigo']} "
                        f"Q{v['quadra']}-L{v['lote']} {v['clienteNome']} (entrada R$ {v['entrada'] or 0}) — "
                        f"o carnê fica ancorado em 03/2026 até alguém informar; a entrada aparece em aberto")
    vendas_out.append(venda)
    registros.append(venda)

# ── lotes (status derivado das vendas vivas — o mesmo cálculo do servidor) ───
viva_por_lote = {}
for v in vendas_out:
    if v['situacao'] in ('ativa', 'conferir'):
        viva_por_lote[v['loteId']] = v['id']
for l in ler('lotes'):
    registros.append({ **l, '_col': 'lote', 'origem': 'planilha',
                       'status': 'Vendido' if l['id'] in viva_por_lote else 'Disponível',
                       'vendaId': viva_por_lote.get(l['id']) })

# ── recebimentos (a entrada recebida de cada venda) ──────────────────────────
rb = 0
for v in vendas_out:
    if (v['entrada'] or 0) > 0 and v['dataEntrada']:
        rb += 1
        registros.append({
            '_col': 'rec', 'id': 'rbent-' + v['id'],
            'origem': 'planilha',
            'numero': rb, 'codigo': f'RB-{rb:04d}',
            'vendaId': v['id'], 'tipo': 'entrada',
            'valor': v['entrada'], 'data': v['dataEntrada'], 'forma': v['formaEntrada'],
            'obs': 'entrada da venda (importação)',
            'criadoEm': v['dataEntrada'] + 'T12:00:00.000Z', 'criadoPor': 'importação da planilha',
        })

# ── caixa: comissões pagas (das vendas) ──────────────────────────────────────
cx = 0
_cx_vistos = {}
def add_cx(**kw):
    global cx
    cx += 1
    base = idHash(kw.get('tipo'), kw.get('data'), kw.get('descricao'), kw.get('valor'), kw.get('vendaId', ''))
    _cx_vistos[base] = _cx_vistos.get(base, 0) + 1
    registros.append({ '_col': 'cx', 'id': 'cx-' + base + ('' if _cx_vistos[base] == 1 else '-' + str(_cx_vistos[base])),
                       'origem': 'planilha',
                       'criadoPor': 'importação da planilha',
                       'criadoEm': (kw.get('data') or '2026-08-21') + 'T12:00:00.000Z', **kw })

for v in vendas_out:
    if (v['comissao'] or 0) > 0:
        # a planilha só data o pagamento; sem data = ainda devida (fica fora do caixa)
        vraw = next(x for x in vendas if x['loteId'] == v['loteId'] and x['clienteNome'] == v['clienteNome'])
        if vraw.get('comissaoData'):
            if not v.get('corretorId'):
                conferir.append(f"Comissão paga SEM corretor identificado: {v['codigo']} Q{v['quadra']}-L{v['lote']} "
                                f"R$ {v['comissao']} em {vraw['comissaoData']} — dizer de quem é na tela de Comissões")
            add_cx(tipo='saida', valor=v['comissao'], data=vraw['comissaoData'],
                   forma=vraw.get('comissaoForma') or '', categoria='Comissão',
                   corretorId=v.get('corretorId') or '', vendaId=v['id'],
                   descricao=f"Comissão — {v['corretorNome'] or 'corretor a identificar'} ({v['codigo']} Q{v['quadra']}-L{v['lote']})")
        else:
            conferir.append(f"Comissão SEM data de pagamento (fica como devida): {v['codigo']} {v['corretorNome']} R$ {v['comissao']}")

# ── caixa: despesas ──────────────────────────────────────────────────────────
def categoria_despesa(desc):
    d = desc.upper()
    if 'COMISS' in d: return 'Comissão'
    if any(k in d for k in ('MARKETING', 'SITE', 'IMPULSION', 'ANUNCIO', 'ANÚNCIO', 'PLACA')): return 'Marketing'
    if any(k in d for k in ('VIVO', 'CELULAR', 'INTERNET', 'CHIP')): return 'Telefone / internet'
    if 'CONTAB' in d: return 'Contabilidade'
    if any(k in d for k in ('TARIFA', 'PACOTE SERVI', 'TED', 'MANUTEN')): return 'Tarifas bancárias'
    if any(k in d for k in ('PATROLA', 'FRETE', 'MAQUINA', 'MÁQUINA', 'TERRAPLAN', 'CASCALHO', 'HORA', 'COMBUST', 'OBRA', 'ESTRADA', 'MEIO FIO', 'REDE', 'POSTE', 'ENERGIA', 'CEMIG')): return 'Obra / infraestrutura'
    if any(k in d for k in ('IMPOSTO', 'TAXA', 'ITBI', 'CARTORIO', 'CARTÓRIO', 'PREFEITURA', 'ALVAR')): return 'Impostos e taxas'
    return 'Outros'

for d in ler('despesas'):
    if d.get('anotacao'):
        continue  # dinheiro já contado (comissão espelhada etc.)
    cat = categoria_despesa(d['descricao'])
    if cat == 'Comissão':
        conferir.append(f"Despesa 'COMISSÃO' com valor na coluna que conta ({d['descricao']} R$ {d['valor']}) — "
                        f"pode duplicar com a comissão da venda; conferir no caixa")
    add_cx(tipo='saida', valor=d['valor'], data=d.get('data') or '', forma=d.get('forma') or '',
           categoria=cat, descricao=d['descricao'], obs=(d.get('obs') or '') +
           ('' if d.get('data') else ' [SEM DATA NA PLANILHA]'))
    if not d.get('data'):
        conferir.append(f"Despesa sem data: {d['descricao']} R$ {d['valor']} — datar na tela do Caixa")

# ── caixa: outras receitas ───────────────────────────────────────────────────
def categoria_receita(desc):
    d = desc.upper()
    if 'ALUGUEL' in d or 'ANTENA' in d: return 'Aluguel'
    if 'ANTECIP' in d: return 'Antecipação'
    return 'Outros'

for r in ler('receitas'):
    if r.get('anotacao'):
        continue  # entrada de venda já contada em 'rec'
    add_cx(tipo='entrada', valor=r['valor'], data=r.get('data') or '', forma=r.get('forma') or '',
           categoria=categoria_receita(r['descricao']), descricao=r['descricao'], obs=r.get('obs') or '')
    if not r.get('data'):
        conferir.append(f"Receita sem data: {r['descricao']} R$ {r['valor']}")

# ── a venda órfã (Wagner) entra no caixa para o total bater ──────────────────
for p in ler('pendencias'):
    dado = p.get('dado')
    if dado and dado.get('entrada'):
        add_cx(tipo='entrada', valor=dado['entrada'], data=dado.get('data') or '', forma=dado.get('forma') or '',
               categoria='Outros', descricao=(p.get('quem') or '?') + ' — entrada SEM lote (linha órfã da planilha)',
               obs='decidir de qual lote é; se virar venda, estornar aqui e lançar na venda')
    conferir.append(f"{p.get('onde','')}: {p.get('quem','')} — {p['problema']}")

# ── grava ─────────────────────────────────────────────────────────────────────
(SEED / 'importar.json').write_text(json.dumps({ 'action': 'importar', 'registros': registros },
                                    ensure_ascii=False), encoding='utf-8')
md = ['# Conferências da importação — Portal dos Bosques', '',
      f'Gerado por scripts/gerar-import.py. {len(registros)} registros no importar.json.', '']
md += [f'- [ ] {c}' for c in conferir]
(SEED / 'CONFERIR.md').write_text('\n'.join(md) + '\n', encoding='utf-8')

por_col = {}
for r in registros:
    por_col[r['_col']] = por_col.get(r['_col'], 0) + 1
print('importar.json gerado:')
for k, v in sorted(por_col.items()):
    print(f'  {k}: {v}')
print(f'  conferências no CONFERIR.md: {len(conferir)}')

# conferência de dinheiro (contra o que a extração provou)
tot_rec = sum(r['valor'] for r in registros if r['_col'] == 'rec')
tot_cx_e = sum(r['valor'] for r in registros if r['_col'] == 'cx' and r['tipo'] == 'entrada')
tot_cx_s = sum(r['valor'] for r in registros if r['_col'] == 'cx' and r['tipo'] == 'saida')
print(f'\n  recebimentos de venda : R$ {tot_rec:,.2f} (alvo 229.843,69 − 12.974,82 sem data = 216.868,87)')
print(f'  caixa entradas avulsas: R$ {tot_cx_e:,.2f} (alvo 123.834,60 + 1.000 órfã = 124.834,60)')
print(f'  caixa saídas          : R$ {tot_cx_s:,.2f} (alvo despesas 232.180,56 + comissões pagas 108.314,20)')
