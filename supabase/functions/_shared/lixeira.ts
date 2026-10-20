// Espelho do Omie (rbomie- recebimento, cxomie- despesa) que uma PESSOA mandou
// para a lixeira não some de vez: vira lápide. Sem ela, a releitura completa
// semanal do Omie não acharia o registro apagado e recriaria o lançamento que
// alguém tirou de propósito. A lápide guarda só o que a sincronização confere
// (apagadoEm, apagadoPor e valor); o que o Omie mesmo estornou pode sumir.
export function precisaLapide(id: string, o: any): boolean {
  return /^(rbomie|cxomie)-/.test(String(id)) && !!o?.apagadoEm && o.apagadoPor !== "omie";
}

export function lapideDe(o: any) {
  return {
    id: o.id, apagadoEm: o.apagadoEm, apagadoPor: o.apagadoPor, lapide: true,
    valor: o.valor ?? null, data: o.data ?? null, omie: { titulo: o.omie?.titulo ?? null },
    atualizadoEm: o.atualizadoEm || o.apagadoEm,
  };
}
