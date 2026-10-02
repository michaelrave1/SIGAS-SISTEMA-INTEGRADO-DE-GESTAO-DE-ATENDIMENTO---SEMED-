import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompletionServiceType, serviceActionOptions } from "../src/lib/service-actions.ts";

test("encerramento utiliza a ação canônica COMPLETE e não um tipo comum", () => {
  assert.deepEqual(serviceActionOptions.filter(([action]) => action === "COMPLETE"), [["COMPLETE", "Encerramento do atendimento"]]);
  for (const [key, name] of [
    ["encerrar_atendimento", "Nome alterado"],
    ["ENCERRAR ATENDIMENTO", "ENCERRAR ATENDIMENTO"],
    ["outro", " Encerramento  do atendimento "],
  ]) assert.equal(isCompletionServiceType(key,name),true);
  for (const name of ["Diagnóstico", "Ação realizada", "Visita", "Material", "Observação técnica"])
    assert.equal(isCompletionServiceType(name,name),false);
});
