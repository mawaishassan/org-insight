"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

const FIELD_TYPES = [
  "single_line_text",
  "multi_line_text",
  "number",
  "date",
  "boolean",
  "multi_line_items",
  "formula",
] as const;

interface KpiField {
  id: number;
  kpi_id: number;
  name: string;
  key: string;
  field_type: string;
  formula_expression: string | null;
  is_required: boolean;
  sort_order: number;
  options: Array<{ id: number; value: string; label: string; sort_order: number }>;
}

interface KpiInfo {
  id: number;
  name: string;
  year: number;
}

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  key: z.string().min(1, "Key required").regex(/^[a-z0-9_]+$/, "Key: lowercase letters, numbers, underscore only"),
  field_type: z.enum(FIELD_TYPES),
  formula_expression: z.string().optional(),
  is_required: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
});

const updateSchema = z.object({
  name: z.string().min(1, "Name required"),
  key: z.string().min(1, "Key required").regex(/^[a-z0-9_]+$/, "Key: lowercase letters, numbers, underscore only"),
  field_type: z.enum(FIELD_TYPES),
  formula_expression: z.string().optional(),
  is_required: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
});

type CreateFormData = z.infer<typeof createSchema>;
type UpdateFormData = z.infer<typeof updateSchema>;

export default function KpiFieldsPage() {
  const params = useParams();
  const kpiId = Number(params.id);
  const [kpi, setKpi] = useState<KpiInfo | null>(null);
  const [list, setList] = useState<KpiField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const token = getAccessToken();

  const loadKpi = () => {
    if (!token || !kpiId) return;
    api<KpiInfo>(`/kpis/${kpiId}`, { token })
      .then(setKpi)
      .catch(() => setKpi(null));
  };

  const loadList = () => {
    if (!token || !kpiId) return;
    setError(null);
    api<KpiField[]>(`/fields?kpi_id=${kpiId}`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadKpi();
  }, [kpiId]);

  useEffect(() => {
    loadList();
  }, [kpiId]);

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      key: "",
      field_type: "single_line_text",
      formula_expression: "",
      is_required: false,
      sort_order: list.length,
    },
  });

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token || !kpiId) return;
    setError(null);
    try {
      await api("/fields", {
        method: "POST",
        body: JSON.stringify({
          kpi_id: kpiId,
          name: data.name,
          key: data.key,
          field_type: data.field_type,
          formula_expression: data.field_type === "formula" ? (data.formula_expression || null) : null,
          is_required: data.is_required,
          sort_order: data.sort_order,
          options: [],
        }),
        token,
      });
      createForm.reset({
        name: "",
        key: "",
        field_type: "single_line_text",
        formula_expression: "",
        is_required: false,
        sort_order: list.length + 1,
      });
      setShowCreate(false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (fieldId: number, data: UpdateFormData) => {
    if (!token) return;
    setError(null);
    try {
      await api(`/fields/${fieldId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          key: data.key,
          field_type: data.field_type,
          formula_expression: data.field_type === "formula" ? (data.formula_expression || null) : null,
          is_required: data.is_required,
          sort_order: data.sort_order,
        }),
        token,
      });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (fieldId: number) => {
    if (!token) return;
    if (!confirm("Delete this field? Stored values will be removed.")) return;
    setError(null);
    try {
      await api(`/fields/${fieldId}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (!kpiId) return <p>Invalid KPI.</p>;
  if (loading && list.length === 0 && !kpi) return <p>Loading...</p>;

  const content = (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/dashboard/kpis" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{"\u2190"} KPIs</Link>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>
          Fields for {kpi ? `${kpi.name} (${kpi.year})` : `KPI #${kpiId}`}
        </h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowCreate((s) => !s)}
        >
          {showCreate ? "Cancel" : "Add field"}
        </button>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Create field</h2>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Name * (display label)</label>
              <input {...createForm.register("name")} placeholder="e.g. Total students" />
              {createForm.formState.errors.name && (
                <p className="form-error">{createForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Key * (unique, lowercase, e.g. total_students)</label>
              <input {...createForm.register("key")} placeholder="total_students" />
              {createForm.formState.errors.key && (
                <p className="form-error">{createForm.formState.errors.key.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Field type *</label>
              <select {...createForm.register("field_type")}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            {createForm.watch("field_type") === "formula" && (
              <div className="form-group">
                <label>Formula (e.g. field_a + field_b or SUM(field_a, field_b))</label>
                <input {...createForm.register("formula_expression")} placeholder="field_a + field_b" />
              </div>
            )}
            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" {...createForm.register("is_required")} />
                Required
              </label>
            </div>
            <div className="form-group">
              <label>Sort order</label>
              <input type="number" min={0} {...createForm.register("sort_order")} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting ? "Creating..." : "Create"}
              </button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No fields yet. Add one above to build the data entry form for this KPI.</p>
        ) : (
          <ul style={{ listStyle: "none" }}>
            {list.map((f) => (
              <li key={f.id} style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                {editingId === f.id ? (
                  <FieldEditForm
                    field={f}
                    onSave={(data) => onUpdateSubmit(f.id, data)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div>
                      <strong>{f.name}</strong>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem", fontSize: "0.9rem" }}>({f.key})</span>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}> - {f.field_type.replace(/_/g, " ")}</span>
                      {f.is_required && <span style={{ marginLeft: "0.5rem", color: "var(--warning)" }}>Required</span>}
                      {f.field_type === "formula" && f.formula_expression && (
                        <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          Formula: {f.formula_expression}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="button" className="btn" onClick={() => setEditingId(f.id)}>Edit</button>
                      <button type="button" className="btn" onClick={() => onDelete(f.id)} style={{ color: "var(--error)" }}>Delete</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
  return content;
}

function FieldEditForm({
  field,
  onSave,
  onCancel,
}: {
  field: KpiField;
  onSave: (data: UpdateFormData) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      name: field.name,
      key: field.key,
      field_type: field.field_type as CreateFormData["field_type"],
      formula_expression: field.formula_expression ?? "",
      is_required: field.is_required,
      sort_order: field.sort_order,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSave)} style={{ width: "100%" }}>
      <div className="form-group">
        <label>Name *</label>
        <input {...register("name")} />
        {errors.name && <p className="form-error">{errors.name.message}</p>}
      </div>
      <div className="form-group">
        <label>Key *</label>
        <input {...register("key")} />
        {errors.key && <p className="form-error">{errors.key.message}</p>}
      </div>
      <div className="form-group">
        <label>Field type *</label>
        <select {...register("field_type")}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      {watch("field_type") === "formula" && (
        <div className="form-group">
          <label>Formula</label>
          <input {...register("formula_expression")} />
        </div>
      )}
      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" {...register("is_required")} />
          Required
        </label>
      </div>
      <div className="form-group">
        <label>Sort order</label>
        <input type="number" min={0} {...register("sort_order")} />
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
