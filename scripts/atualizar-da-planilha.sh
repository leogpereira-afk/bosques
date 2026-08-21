#!/bin/bash
# MODO HÍBRIDO: a planilha continua sendo digitada; rode isto para o sistema
# se atualizar dela. Extrai → gera → sobe (pede a senha da direção no fim).
#
# Uso: ./scripts/atualizar-da-planilha.sh [caminho do GerenciadorLoteamento.xlsx]
#      (sem argumento, usa ~/Downloads/GerenciadorLoteamento.xlsx)
set -e
cd "$(dirname "$0")/.."
XLSX="${1:-$HOME/Downloads/GerenciadorLoteamento.xlsx}"
[ -f "$XLSX" ] || { echo "Não achei a planilha: $XLSX"; exit 1; }
echo "1/3 extraindo de $XLSX…"
python3 scripts/extrair-planilha.py "$XLSX"
echo
echo "2/3 gerando o importar.json…"
python3 scripts/gerar-import.py
echo
echo "3/3 subindo para o servidor…"
./scripts/subir-import.sh
echo
echo "Pendências para conferir: seed/CONFERIR.md"
