import { test } from "node:test";
import assert from "node:assert/strict";
import { professionalRoleScope } from "../src/lib/professional-role-scope.ts";

test("troca de responsável para administrador remove unidade e área residuais",()=>{
  assert.deepEqual(professionalRoleScope("admin","unidade","DETIC"),{unit_id:"",area:""});
  assert.deepEqual(professionalRoleScope("gestor_area","unidade","DETIC"),{unit_id:"",area:"DETIC"});
  assert.deepEqual(professionalRoleScope("responsavel","unidade","DETIC"),{unit_id:"unidade",area:"DETIC"});
  for(const role of ["gestor","solicitante"]) assert.deepEqual(professionalRoleScope(role,"unidade","DETIC"),{unit_id:"unidade",area:""});
});
