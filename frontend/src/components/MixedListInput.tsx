"use client";

import React, { useMemo, useState } from "react";

type MixedAtom = string | number;

type Props = {
  value: MixedAtom[];
  onChange: (next: MixedAtom[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function inferAtom(raw: string): MixedAtom | null {
  const t = raw.trim();
  if (!t) return null;
  if (isIsoDate(t)) return t; // keep as ISO date string
  const num = Number(t.replace(/,/g, ""));
  if (!Number.isNaN(num) && Number.isFinite(num) && t.match(/^[+-]?\d[\d,]*(\.\d+)?$/)) {
    // Preserve ints as ints
    if (Number.isInteger(num)) return num;
    return num;
  }
  return t;
}

function atomKey(a: MixedAtom): string {
  return typeof a === "number" ? `n:${a}` : `s:${a}`;
}

export default function MixedListInput({ value, onChange, disabled, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  const canAdd = useMemo(() => {
    const atom = inferAtom(draft);
    return atom !== null;
  }, [draft]);

  const add = () => {
    const atom = inferAtom(draft);
    if (atom == null) return;
    onChange([...(Array.isArray(value) ? value : []), atom]);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" }}>
        {(Array.isArray(value) ? value : []).map((v, idx) => (
          <span
            key={`${atomKey(v)}:${idx}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              padding: "0.15rem 0.45rem",
              borderRadius: 12,
              background: "var(--bg-subtle, #f3f4f6)",
              fontSize: "0.8rem",
              maxWidth: "100%",
            }}
            title={String(v)}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{String(v)}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${String(v)}`}
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                  color: "var(--danger, #b91c1c)",
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {!disabled && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
          <input
            type="text"
            value={draft}
            placeholder={placeholder ?? "Type a value (text, number, or YYYY-MM-DD)"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            style={{
              flex: "1 1 160px",
              minWidth: 120,
              padding: "0.35rem 0.5rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              fontSize: "0.85rem",
            }}
          />
          <button
            type="button"
            className="btn"
            style={{ padding: "0.3rem 0.55rem", fontSize: "0.8rem" }}
            disabled={!canAdd}
            onClick={add}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

