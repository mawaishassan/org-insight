"use client";

/**
 * Dynamic form renderer for KPI fields.
 * Renders inputs based on field type (single_line_text, number, date, boolean, multi_line_items, formula).
 */

import { useFormContext } from "react-hook-form";

export type FieldType =
  | "single_line_text"
  | "multi_line_text"
  | "number"
  | "date"
  | "boolean"
  | "multi_line_items"
  | "formula";

export interface KpiFieldDef {
  id: number;
  key: string;
  name: string;
  field_type: FieldType;
  is_required: boolean;
  formula_expression?: string | null;
  config?: Record<string, unknown> | null;
  options?: Array<{ value: string; label: string }>;
}

interface Props {
  fields: KpiFieldDef[];
  disabled?: boolean;
}

export default function DynamicKpiForm({ fields, disabled }: Props) {
  const { register, formState: { errors } } = useFormContext();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {fields.map((f) => {
        const name = `values.${f.id}`;
        const err = errors.values?.[f.id as keyof typeof errors.values];

        if (f.field_type === "formula") {
          return (
            <div key={f.id} className="form-group">
              <label>{f.name} (formula)</label>
              <input
                type="text"
                readOnly
                disabled
                placeholder={f.formula_expression || "—"}
                style={{ opacity: 0.8 }}
              />
            </div>
          );
        }

        if (f.field_type === "single_line_text") {
          return (
            <div key={f.id} className="form-group">
              <label htmlFor={name}>{f.name}{f.is_required ? " *" : ""}</label>
              <input
                id={name}
                type="text"
                {...register(`${name}.value_text`)}
                disabled={disabled}
              />
              {err && <p className="form-error">{(err as { message?: string }).message}</p>}
            </div>
          );
        }

        if (f.field_type === "multi_line_text") {
          return (
            <div key={f.id} className="form-group">
              <label htmlFor={name}>{f.name}{f.is_required ? " *" : ""}</label>
              <textarea
                id={name}
                rows={3}
                {...register(`${name}.value_text`)}
                disabled={disabled}
              />
              {err && <p className="form-error">{(err as { message?: string }).message}</p>}
            </div>
          );
        }

        if (f.field_type === "number") {
          return (
            <div key={f.id} className="form-group">
              <label htmlFor={name}>{f.name}{f.is_required ? " *" : ""}</label>
              <input
                id={name}
                type="number"
                step="any"
                {...register(`${name}.value_number`, { valueAsNumber: true })}
                disabled={disabled}
              />
              {err && <p className="form-error">{(err as { message?: string }).message}</p>}
            </div>
          );
        }

        if (f.field_type === "date") {
          return (
            <div key={f.id} className="form-group">
              <label htmlFor={name}>{f.name}{f.is_required ? " *" : ""}</label>
              <input
                id={name}
                type="date"
                {...register(`${name}.value_date`)}
                disabled={disabled}
              />
              {err && <p className="form-error">{(err as { message?: string }).message}</p>}
            </div>
          );
        }

        if (f.field_type === "boolean") {
          return (
            <div key={f.id} className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  {...register(`${name}.value_boolean`)}
                  disabled={disabled}
                />
                {f.name}
              </label>
              {err && <p className="form-error">{(err as { message?: string }).message}</p>}
            </div>
          );
        }

        if (f.field_type === "multi_line_items") {
          return (
            <div key={f.id} className="form-group">
              <label>{f.name}{f.is_required ? " *" : ""}</label>
              <textarea
                placeholder="One item per line or JSON array"
                {...register(`${name}.value_text`)}
                disabled={disabled}
                rows={4}
              />
              {err && <p className="form-error">{(err as { message?: string }).message}</p>}
            </div>
          );
        }

        return (
          <div key={f.id} className="form-group">
            <label htmlFor={name}>{f.name}</label>
            <input id={name} type="text" {...register(`${name}.value_text`)} disabled={disabled} />
          </div>
        );
      })}
    </div>
  );
}
