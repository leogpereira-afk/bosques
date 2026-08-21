#!/bin/bash
# Checagem de SINTAXE (não executa): embrulha o arquivo em new Function().
# O jsc do macOS compila o corpo; erro de sintaxe estoura com linha.
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
ok=0
for f in "$@"; do
  if python3 - "$f" <<'PY' > /tmp/_wrap.js
import sys, json
src = open(sys.argv[1], encoding='utf-8').read()
print('try { new Function(' + json.dumps(src) + '); print("SINTAXE_OK") } catch (e) { print("ERRO: " + e) }')
PY
  then
    r=$("$JSC" /tmp/_wrap.js 2>&1)
    if [[ "$r" == "SINTAXE_OK" ]]; then echo "✓ $f"; else echo "✗ $f — $r"; ok=1; fi
  fi
done
exit $ok
