"use client";
import { useState } from "react";
import { fieldLimits } from "@/lib/application-config";
import type { CatalogData } from "@/lib/domain";

const fields = [
  ["area", "Área"],
  ["nature", "Natureza"],
  ["type", "Tipo"],
  ["description", "Descrição"],
  ["detail", "Detalhamento"],
] as const;
export function ClassificationFields({
  initial,
  rows,
  editing,
}: {
  initial: CatalogData;
  rows: CatalogData[];
  editing: boolean;
}) {
  const [values, setValues] = useState(initial);
  return (
    <>
      <p className="span-2">
        Selecione um valor existente ou digite um novo, respeitando os níveis
        anteriores. A área de uma classificação existente não pode ser
        renomeada: ela determina regras e acesso às OS. Para mudar uma
        classificação histórica, crie outra e desative a anterior.
      </p>
      {fields.map(([key, label], index) => {
        const parents = fields
          .slice(0, Math.min(index, 3))
          .map(([parent]) => parent);
        const options = [
          ...new Set(
            rows
              .filter((row) =>
                parents.every(
                  (parent) => (row[parent] ?? "") === (values[parent] ?? ""),
                ),
              )
              .map((row) => row[key])
              .filter(Boolean),
          ),
        ].sort();
        return (
          <label key={key}>
            {label}
            <input
              name={key}
              list={`classification-${key}`}
              value={values[key] ?? ""}
              maxLength={fieldLimits.catalogValue}
              required={key === "area"}
              readOnly={key === "area" && editing}
              disabled={index > 0 && !values[fields[Math.min(index - 1, 2)][0]]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    (index < 3 ? fields.slice(index + 1) : []).map(
                      ([child]) => [child, ""],
                    ),
                  ),
                  [key]:
                    key === "area"
                      ? event.target.value.toLocaleUpperCase("pt-BR")
                      : event.target.value,
                }))
              }
            />
            {index > 0 && !values[fields[Math.min(index - 1, 2)][0]] && (
              <input type="hidden" name={key} value={values[key] ?? ""} />
            )}
            <datalist id={`classification-${key}`}>
              {options.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>
        );
      })}
      {(
        [
          ["options", "Opções"],
          ["reminder", "Lembrete"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            name={key}
            defaultValue={initial[key] ?? ""}
            maxLength={fieldLimits.catalogValue}
          />
        </label>
      ))}
    </>
  );
}
