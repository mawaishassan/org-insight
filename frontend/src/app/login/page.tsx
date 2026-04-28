"use client";

import { useState } from "react";
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
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setError(null);
    try {
      const res = await api<{ access_token: string; refresh_token: string }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      );
      setTokens(res.access_token, res.refresh_token);
      const me = await api<{ role: string; organization_id: number | null }>("/auth/me", { token: res.access_token });
      toast.success("Logged in successfully");
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

      // Prefer a dashboard/report the user can view.
      const [dashboards, reports] = await Promise.all([
        api<Array<{ id: number }>>(`/dashboards?organization_id=${orgId}`, { token: res.access_token }).catch(() => []),
        api<Array<{ id: number }>>(`/reports/templates?organization_id=${orgId}`, { token: res.access_token }).catch(() => []),
      ]);
      if (Array.isArray(dashboards) && dashboards.length > 0) {
        router.push(`/dashboard/dashboards/${dashboards[0]!.id}?organization_id=${orgId}`);
      } else if (Array.isArray(reports) && reports.length > 0) {
        router.push(`/dashboard/reports/${reports[0]!.id}?organization_id=${orgId}`);
      } else {
        router.push("/dashboard/entries");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      toast.error(e instanceof Error ? e.message : "Login failed");
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
          {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
