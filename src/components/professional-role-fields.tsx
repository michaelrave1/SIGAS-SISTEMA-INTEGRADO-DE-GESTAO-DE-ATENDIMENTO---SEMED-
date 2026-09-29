"use client";

import { useState } from "react";
import { roleLabels, roleNames, roles, type Role } from "@/lib/domain";

export function ProfessionalRoleFields({
  initialRole,
  initialArea,
  areas,
  canManage,
}: {
  initialRole: Role;
  initialArea: string;
  areas: string[];
  canManage: boolean;
}) {
  const [role, setRole] = useState<Role>(initialRole);

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
    </>
  );
}
