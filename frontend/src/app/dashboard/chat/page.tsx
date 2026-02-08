"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface ChatSource {
  kpi_id: number;
  kpi_name: string;
  year: number;
  organization_id: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: ChatSource[] | null;
  not_entered?: { kpi_name: string; assigned_user_names: string[] }[];
  not_collected?: boolean;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await api<{
        text: string;
        sources?: ChatSource[] | null;
        not_entered?: { kpi_name: string; assigned_user_names: string[] }[];
        not_collected: boolean;
      }>("/chat/message", {
        method: "POST",
        body: JSON.stringify({ message: text }),
        token: token || undefined,
      });
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: res.text,
        sources: res.sources ?? undefined,
        not_entered: res.not_entered ?? undefined,
        not_collected: res.not_collected ?? false,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: e instanceof Error ? e.message : "Something went wrong. Please try again.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", maxWidth: 900, margin: "0 auto", height: "calc(100vh - 120px)", minHeight: 400 }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "0.75rem", color: "var(--text)" }}>
        Chat with your KPI data
      </h1>
      <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>
        Ask in natural language (e.g. &quot;How many research papers in 2024?&quot;, &quot;Compare enrollment with previous years&quot;).
      </p>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--surface)",
          padding: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: "0.9rem", textAlign: "center", padding: "2rem" }}>
            Send a message to get started.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              padding: "0.75rem 1rem",
              borderRadius: 8,
              background: m.role === "user" ? "var(--accent)" : "var(--bg-subtle)",
              color: m.role === "user" ? "#fff" : "var(--text)",
            }}
          >
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</div>
            {m.role === "assistant" && m.not_collected && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--warning)" }}>
                This information is not currently collected. Contact the system administrator.
              </div>
            )}
            {m.role === "assistant" && m.not_entered && m.not_entered.length > 0 && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                {m.not_entered.map((n, i) => (
                  <div key={i} style={{ color: "var(--warn)" }}>
                    Data for &quot;{n.kpi_name}&quot; not entered yet.
                    {n.assigned_user_names?.length ? ` Responsible: ${n.assigned_user_names.join(", ")}.` : ""}
                  </div>
                ))}
              </div>
            )}
            {m.role === "assistant" && m.sources && m.sources.length > 0 && (
              <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
                <span style={{ color: "var(--muted)", marginRight: "0.35rem" }}>Source:</span>
                {m.sources.map((s) => (
                  <Link
                    key={`${s.kpi_id}-${s.year}`}
                    href={`/dashboard/entries/kpi/${s.kpi_id}?year=${s.year}&organization_id=${s.organization_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      marginRight: "0.5rem",
                      marginTop: "0.25rem",
                      color: "var(--accent)",
                      textDecoration: "none",
                    }}
                  >
                    {s.kpi_name} ({s.year}) →
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start", padding: "0.75rem 1rem", color: "var(--muted)", fontSize: "0.9rem" }}>
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{
          display: "flex",
          gap: "0.5rem",
          marginTop: "0.75rem",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your KPI data..."
          disabled={loading}
          style={{
            flex: 1,
            padding: "0.6rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: "0.95rem",
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: "0.6rem 1rem",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            opacity: loading || !input.trim() ? 0.7 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
