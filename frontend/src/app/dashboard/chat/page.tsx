"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ChatPage() {
  const router = useRouter();

  useEffect(() => {
    // Chat is temporarily disabled. Send users back to a safe page.
    router.replace("/dashboard");
  }, [router]);

  return (
    <div style={{ color: "var(--muted)" }}>
      Chat is temporarily disabled.
    </div>
  );
}
