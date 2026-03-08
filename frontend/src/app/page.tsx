import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 600 }}>Ustadex University Insights</h1>
      <p style={{ color: "var(--muted)" }}>Define → Assign → Collect → Report → Ask</p>
      <Link href="/login" className="btn btn-primary">Sign in</Link>
    </main>
  );
}
