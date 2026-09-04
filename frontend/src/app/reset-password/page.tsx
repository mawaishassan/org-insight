"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { setTokens, clearTokens, getAccessToken } from "@/lib/auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Real-time password policy validation rules
  const rules = useMemo(() => {
    return {
      minLength: newPassword.length >= 8,
      hasUpper: /[A-Z]/.test(newPassword),
      hasLower: /[a-z]/.test(newPassword),
      hasNumber: /\d/.test(newPassword),
      matchesConfirm: newPassword.length > 0 && newPassword === confirmPassword,
    };
  }, [newPassword, confirmPassword]);

  const isFormValid =
    rules.minLength &&
    rules.hasUpper &&
    rules.hasLower &&
    rules.hasNumber &&
    rules.matchesConfirm &&
    currentPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError("Please enter your current password.");
      return;
    }

    if (!rules.minLength || !rules.hasUpper || !rules.hasLower || !rules.hasNumber) {
      setError(
        "New password does not meet all policy requirements (8+ chars, uppercase, lowercase, and number)."
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    if (currentPassword === newPassword) {
      setError("New password cannot be identical to your current password.");
      return;
    }

    const token = getAccessToken();
    if (!token) {
      toast.error("Session expired. Please log in again.");
      router.replace("/login");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api<{
        ok: boolean;
        message: string;
        access_token: string;
        refresh_token: string;
      }>("/auth/reset-forced-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
        token,
      });

      // Update tokens with new credentials and reset flag cleared
      setTokens(res.access_token, res.refresh_token);
      toast.success(res.message || "Password updated successfully!");

      // Redirect to home/dashboard
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reset password.";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = () => {
    clearTokens();
    router.replace("/login");
  };

  return (
    <main
      className="container"
      style={{
        maxWidth: 520,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto",
        padding: "1.5rem 1rem",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          padding: "2.25rem 2.25rem",
          borderRadius: "16px",
          boxShadow: "0 20px 35px -10px rgba(0,0,0,0.08), 0 10px 15px -5px rgba(0,0,0,0.04)",
          border: "1px solid #e2e8f0",
          background: "#ffffff",
        }}
      >
        {/* Header Title */}
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <h1
            style={{
              fontSize: "1.65rem",
              fontWeight: 700,
              color: "#0f172a",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            RESET Password
          </h1>
        </div>

        {error && (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              color: "var(--error)",
              fontSize: "0.88rem",
              marginBottom: "1.15rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Current Password */}
          <div className="form-group" style={{ marginBottom: "1.15rem" }}>
            <label
              htmlFor="current-password"
              style={{
                display: "block",
                color: "#0f172a",
                fontWeight: 600,
                fontSize: "0.92rem",
                marginBottom: "0.45rem",
              }}
            >
              Current Password <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                color: "#0f172a",
                fontSize: "0.95rem",
                fontWeight: 500,
                padding: "0.65rem 0.85rem",
                border: "1.5px solid #cbd5e1",
                borderRadius: "8px",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* New Password */}
          <div className="form-group" style={{ marginBottom: "1.15rem" }}>
            <label
              htmlFor="new-password"
              style={{
                display: "block",
                color: "#0f172a",
                fontWeight: 600,
                fontSize: "0.92rem",
                marginBottom: "0.45rem",
              }}
            >
              New Password <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              style={{
                color: "#0f172a",
                fontSize: "0.95rem",
                fontWeight: 500,
                padding: "0.65rem 0.85rem",
                border: "1.5px solid #cbd5e1",
                borderRadius: "8px",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Confirm Password */}
          <div className="form-group" style={{ marginBottom: "1.2rem" }}>
            <label
              htmlFor="confirm-password"
              style={{
                display: "block",
                color: "#0f172a",
                fontWeight: 600,
                fontSize: "0.92rem",
                marginBottom: "0.45rem",
              }}
            >
              Confirm New Password <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              style={{
                color: "#0f172a",
                fontSize: "0.95rem",
                fontWeight: 500,
                padding: "0.65rem 0.85rem",
                border: "1.5px solid #cbd5e1",
                borderRadius: "8px",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Password Policy Live Checklist */}
          <div
            style={{
              padding: "0.85rem 1rem",
              borderRadius: "8px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              marginBottom: "1.25rem",
              fontSize: "0.84rem",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#1e293b", fontSize: "0.88rem" }}>
              Password Policy Requirements:
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.45rem 0.85rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: rules.minLength ? "var(--success)" : "#64748b" }}>
                <span>{rules.minLength ? "✓" : "○"}</span> At least 8 characters
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: rules.hasUpper ? "var(--success)" : "#64748b" }}>
                <span>{rules.hasUpper ? "✓" : "○"}</span> Uppercase letter (A-Z)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: rules.hasLower ? "var(--success)" : "#64748b" }}>
                <span>{rules.hasLower ? "✓" : "○"}</span> Lowercase letter (a-z)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: rules.hasNumber ? "var(--success)" : "#64748b" }}>
                <span>{rules.hasNumber ? "✓" : "○"}</span> Number (0-9)
              </div>
            </div>
            {confirmPassword.length > 0 && (
              <div
                style={{
                  marginTop: "0.5rem",
                  paddingTop: "0.5rem",
                  borderTop: "1px dashed #cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  color: rules.matchesConfirm ? "var(--success)" : "var(--error)",
                  fontWeight: 500,
                  fontSize: "0.84rem",
                }}
              >
                <span>{rules.matchesConfirm ? "✓ Passwords match" : "✕ Passwords do not match"}</span>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting || !isFormValid}
            style={{
              width: "100%",
              padding: "0.75rem 1.25rem",
              fontSize: "1rem",
              fontWeight: 600,
              borderRadius: "8px",
              cursor: isSubmitting || !isFormValid ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Updating Password..." : "Reset Password & Continue"}
          </button>
        </form>

        <div style={{ marginTop: "1.15rem", textAlign: "center" }}>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              background: "transparent",
              border: "none",
              color: "#64748b",
              fontSize: "0.88rem",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Sign out of this account
          </button>
        </div>
      </div>
    </main>
  );
}
