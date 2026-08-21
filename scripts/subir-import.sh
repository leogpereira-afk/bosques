#!/bin/bash
# Sobe o seed/importar.json para o servidor (ação 'restaurar', só direção).
# Uso: ./scripts/subir-import.sh
# Requer: config.js já apontando para o projeto real, e a senha da direção.
set -e
cd "$(dirname "$0")/.."
API=$(grep -o "https://[a-z0-9]*\.supabase\.co" config.js | head -1)/functions/v1/bsq-nucleo
TOKEN=$(grep -o "bsq-[a-f0-9]*" config.js | head -1)
if [[ "$API" == *SEU_PROJETO* || -z "$TOKEN" ]]; then echo "config.js ainda aponta para SEU_PROJETO — configure antes."; exit 1; fi
read -s -p "Senha da direção: " SENHA; echo
HASH=$(printf '%s' "$SENHA" | shasum -a 256 | cut -d' ' -f1)
echo "Enviando $(python3 -c "import json;print(len(json.load(open('seed/importar.json'))['registros']))") registros para $API …"
curl -sS -X POST "$API" \
  -H "content-type: application/json" \
  -H "x-token: $TOKEN" \
  -H "x-senha: $HASH" \
  -H "x-quem: importa%C3%A7%C3%A3o" \
  --data-binary @seed/importar.json | python3 -m json.tool
echo "Confira em seguida: abra o app, espelho e caixa devem bater com a planilha."
