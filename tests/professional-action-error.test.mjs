import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProfessionalError } from "../src/lib/professional-action-error.ts";
import { actionErrorMessages } from "../src/lib/action-result.ts";

test("erros do cadastro distinguem configuração, autorização e vínculos sem SQL", () => {
  for (const [error, expected] of [
    [{ code: "P0001", message: "Perfil de acesso inválido ou inativo" }, "professional_configuration"],
    [{ code: "42501" }, "forbidden"],
    [{ message: "Área obrigatória para este perfil" }, "validation"],
    [{ message: "Área inválida" }, "validation"],
    [{ code: "23505", message: "private SQL detail" }, "professional_conflict"],
    [{ message: "Vínculo de solicitante referenciado por ordem" }, "professional_conflict"],
    [{ code: "XX000", message: "private SQL detail" }, "unexpected"],
  ]) {
    assert.equal(classifyProfessionalError(error), expected);
    assert.doesNotMatch(actionErrorMessages[expected], /SQL|private|P0001|23505/);
  }
});
