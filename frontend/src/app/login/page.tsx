"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { setTokens } from "@/lib/auth";

const schema = z.object({
  username: z.string().min(1, "Username required"),
  password: z.string().min(1, "Password required"),
  captcha_answer: z.string().min(1, "Answer required"),
  captcha_id: z.string(),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [captchaQuestion, setCaptchaQuestion] = useState<string | null>(null);
  const [isLoadingCaptcha, setIsLoadingCaptcha] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function fetchCaptcha() {
    setIsLoadingCaptcha(true);
    try {
      const data = await api<{ captcha_id: string; question: string }>("/auth/captcha");
      setCaptchaQuestion(data.question);
      setValue("captcha_id", data.captcha_id);
      setValue("captcha_answer", ""); // reset answer field
    } catch (e) {
      toast.error("Failed to load verification challenge");
    } finally {
      setIsLoadingCaptcha(false);
    }
  }

  useEffect(() => {
    fetchCaptcha();
  }, []);

  async function onSubmit(data: FormData) {
    setError(null);
    try {
      const res = await api<{ access_token: string; refresh_token: string; force_password_reset?: boolean }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      );
      setTokens(res.access_token, res.refresh_token);
      const me = await api<{ role: string; organization_id: number | null; force_password_reset?: boolean }>(
        "/auth/me",
        { token: res.access_token }
      );

      if (res.force_password_reset || me.force_password_reset) {
        toast("Password reset required before continuing.", { icon: "🔒" });
        router.push("/reset-password");
        router.refresh();
        return;
      }

      toast.success("Logged in successfully");

      const searchParams = new URLSearchParams(window.location.search);
      const redirectTo = searchParams?.get("redirect");
      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
        return;
      }

      if (me.role === "SUPER_ADMIN") {
        router.push("/dashboard/organizations");
        router.refresh();
        return;
      }

      const orgId = me.organization_id;
      if (!orgId) {
        router.push("/dashboard/no-access");
        router.refresh();
        return;
      }

      // Default home:
      // - If user has KPI rights, land on KPIs/Entries page.
      // - Otherwise, land on the dashboard home (not a specific dashboard).
      const available = await api<Array<{ id: number }>>(
        `/entries/available-kpis?organization_id=${orgId}&limit=1`,
        { token: res.access_token }
      ).catch(() => []);
      const hasKpiRights = Array.isArray(available) && available.length > 0;
      if (hasKpiRights) {
        router.push("/dashboard/entries");
      } else {
        router.push(`/dashboard/dashboards?organization_id=${orgId}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      toast.error(e instanceof Error ? e.message : "Login failed");
      fetchCaptcha(); // Refresh verification challenge on failure!
    }
  }

  return (
    <main className="container" style={{ maxWidth: 400, marginTop: "4rem" }}>
      <div className="card">
        <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Sign in</h1>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input id="username" {...register("username")} autoComplete="username" />
            {errors.username && <p className="form-error">{errors.username.message}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" {...register("password")} autoComplete="current-password" />
            {errors.password && <p className="form-error">{errors.password.message}</p>}
          </div>

          <div className="form-group" style={{ marginBottom: "1.5rem" }}>
            <label htmlFor="captcha_answer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Verification Challenge</span>
              <button
                type="button"
                className="btn"
                onClick={fetchCaptcha}
                disabled={isLoadingCaptcha}
                style={{
                  padding: "0.2rem 0.5rem",
                  fontSize: "0.8rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  border: "none",
                  background: "transparent",
                  color: "var(--accent)",
                  cursor: "pointer",
                }}
                title="Refresh challenge"
              >
                <svg
                  className={isLoadingCaptcha ? "animate-spin-custom" : ""}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <span>Refresh</span>
              </button>
            </label>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                padding: "1rem",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                marginBottom: "0.5rem",
              }}
            >
              <div
                style={{
                  fontSize: "1.1rem",
                  fontWeight: "bold",
                  color: "var(--text)",
                  fontFamily: "monospace",
                  textAlign: "center",
                  letterSpacing: "0.02em",
                  userSelect: "none",
                }}
              >
                {captchaQuestion || "Loading challenge..."}
              </div>
              <input
                id="captcha_answer"
                placeholder="Enter answer"
                {...register("captcha_answer")}
                autoComplete="off"
                style={{
                  textAlign: "center",
                  fontSize: "1rem",
                }}
              />
            </div>
            {errors.captcha_answer && <p className="form-error">{errors.captcha_answer.message}</p>}
          </div>

          {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

