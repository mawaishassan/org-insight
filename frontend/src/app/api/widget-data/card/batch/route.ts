import { NextResponse } from "next/server";

function backendBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
}

export async function POST(req: Request) {
  const base = backendBaseUrl().replace(/\/+$/, "");
  const url = `${base}/api/widget-data/card/batch`;
  const body = await req.text();
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body,
    cache: "no-store",
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/json",
    },
  });
}

