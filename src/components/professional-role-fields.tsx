"use client";

import { useState } from "react";
import { roleLabels, roleNames, roles, type Role } from "@/lib/domain";
import { professionalRoleScope } from "@/lib/professional-role-scope";

export function ProfessionalRoleFields({
  initialRole,
  initialArea,
  areas,
  canManage,
  initialUnit,
  units,
}: {
  initialRole: Role;
  initialArea: string;
  areas: string[];
  canManage: boolean;
  initialUnit: string;
  units: { id: string; name: string }[];
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const [unit, setUnit] = useState(initialUnit);
  const scope = professionalRoleScope(role, unit, initialArea);
  const globalScope =
    role === roleNames.administrator || role === roleNames.areaManager;

  return (
    <>
      <label>
        Papel
        <select
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          {roles
            .filter(
              (availableRole) =>
                canManage || availableRole !== roleNames.administrator,
            )
            .map((availableRole) => (
              <option key={availableRole} value={availableRole}>
                {roleLabels[availableRole]}
              </option>
            ))}
        </select>
      </label>
      {(role === roleNames.responsible || role === roleNames.areaManager) && (
        <label>
          Área
          <select name="area" defaultValue={initialArea} required>
            <option value="">Selecione</option>
            {areas.map((area) => (
              <option key={area}>{area}</option>
            ))}
          </select>
        </label>
      )}
      {globalScope ? (
        <>
          <input type="hidden" name="unit_id" value="" />
          <p className="muted">
            {role === roleNames.administrator
              ? "Administrador possui acesso global, sem vínculo com unidade ou área."
              : "Gestor de área possui escopo pela área selecionada, sem vínculo com unidade."}
          </p>
        </>
      ) : (
        <label>
          Unidade
          <select
            name="unit_id"
            value={scope.unit_id}
            required={
              role === roleNames.responsible || role === roleNames.requester
            }
            onChange={(event) => setUnit(event.target.value)}
          >
            <option value="">Selecione</option>
            {units.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
