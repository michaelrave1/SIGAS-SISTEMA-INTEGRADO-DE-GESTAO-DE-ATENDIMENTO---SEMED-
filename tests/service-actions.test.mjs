import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableServiceOptions,
  isServiceProgressAction,
  isCompletionServiceType,
  serviceActionOptions,
} from "../src/lib/service-actions.ts";

test("seletor permite avançar o atendimento sem ampliar as permissões", () => {
  const options = (operations, issues = 0) =>
    availableServiceOptions(
      operations.map((operation) => ({ operation })),
      issues,
    ).map(([action]) => action);
  assert.deepEqual(options(["ACCEPT_ASSIGNMENT", "RETURN_TRIAGE"]), [
    "ACCEPT_ASSIGNMENT",
    "RETURN_TRIAGE",
    "COMPLETE",
  ]);
  assert.deepEqual(options(["START_SERVICE", "RETURN_TRIAGE"]), [
    "START_SERVICE",
    "RETURN_TRIAGE",
    "COMPLETE",
  ]);
  assert.deepEqual(options(["RETURN_TRIAGE"]), ["RETURN_TRIAGE", "COMPLETE"]);
  assert.deepEqual(options([]), []);
  assert.deepEqual(options(["TRIAGE", "ASSIGN"]), []);
  for (const action of [
    "IMPEDIMENT",
    "PENDING",
    "REQUEST_INFORMATION",
    "REQUEST_FORWARDING",
    "OPERATIONAL_UPDATE",
  ]) {
    const displayed = options([action]);
    assert.ok(displayed.includes(action));
    assert.ok(displayed.includes("COMPLETE"));
  }
  assert.deepEqual(options(["RESUME", "RESOLVE"]), ["RESUME", "COMPLETE"]);
  assert.deepEqual(options(["RESUME", "RESOLVE"], 1), [
    "RESUME",
    "COMPLETE",
    "RESOLVE",
  ]);
  for (const action of ["ACCEPT_ASSIGNMENT", "START_SERVICE", "RESUME"])
    assert.equal(isServiceProgressAction(action), true);
  for (const action of ["RETURN_TRIAGE", "ADD_SERVICE_ENTRY", "COMPLETE", ""])
    assert.equal(isServiceProgressAction(action), false);
});

test("encerramento utiliza a ação canônica COMPLETE e não um tipo comum", () => {
  const allActions = serviceActionOptions.map(([operation]) => ({ operation }));
  assert.deepEqual(
    availableServiceOptions(allActions, 1),
    serviceActionOptions,
  );
  assert.deepEqual(
    availableServiceOptions([{ operation: "ADD_SERVICE_ENTRY" }], 0).map(
      ([action]) => action,
    ),
    ["ADD_SERVICE_ENTRY", "COMPLETE"],
  );
  assert.deepEqual(
    serviceActionOptions.filter(([action]) => action === "COMPLETE"),
    [["COMPLETE", "Encerramento do atendimento"]],
  );
  for (const [key, name] of [
    ["encerrar_atendimento", "Nome alterado"],
    ["ENCERRAR ATENDIMENTO", "ENCERRAR ATENDIMENTO"],
    ["outro", " Encerramento  do atendimento "],
  ])
    assert.equal(isCompletionServiceType(key, name), true);
  for (const name of [
    "Diagnóstico",
    "Ação realizada",
    "Visita",
    "Material",
    "Observação técnica",
  ])
    assert.equal(isCompletionServiceType(name, name), false);
});
