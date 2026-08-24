import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: "3rem", textAlign: "center" }}>
      <h2>Page Not Found</h2>
      <p style={{ color: "var(--muted)" }}>Could not find requested resource</p>
      <Link href="/dashboard" className="btn btn-primary">
        Return to Dashboard
      </Link>
    </div>
  );
}
