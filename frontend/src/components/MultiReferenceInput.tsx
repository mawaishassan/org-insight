"use client";

import React, { useId, useMemo, useState } from "react";

type Props = {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

/** Multi-select from allowed reference values (same source KPI/field as single reference). */
export default function MultiReferenceInput({ options, value, onChange, disabled, placeholder }: Props) {
  const id = useId();
  const listId = `${id}-mr-list`;
  const [draft, setDraft] = useState("");

  const uniqOptions = useMemo(() => Array.from(new Set(options.filter(Boolean))), [options]);

  const addToken = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" }}>
        {value.map((v) => (
          <span
            key={v}
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
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(value.filter((x) => x !== v))}
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
            list={listId}
            value={draft}
            placeholder={placeholder ?? "Type to filter, then pick or press Enter"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const pick = draft.trim();
                if (pick && uniqOptions.includes(pick)) addToken(pick);
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
          <datalist id={listId}>
            {uniqOptions.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn"
            style={{ padding: "0.3rem 0.55rem", fontSize: "0.8rem" }}
            disabled={!draft.trim() || !uniqOptions.includes(draft.trim())}
            onClick={() => addToken(draft)}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
