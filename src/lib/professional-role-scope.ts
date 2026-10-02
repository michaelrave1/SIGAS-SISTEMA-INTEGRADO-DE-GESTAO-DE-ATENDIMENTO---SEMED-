export function professionalRoleScope(
  role: string,
  unit: string,
  area: string,
) {
  return {
    unit_id: role === "admin" || role === "gestor_area" ? "" : unit,
    area: role === "responsavel" || role === "gestor_area" ? area : "",
  };
}
