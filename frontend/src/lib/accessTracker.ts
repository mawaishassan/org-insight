/**
 * Access tracking helper: compares currently accessible dashboards and reports
 * against previously known items to highlight newly granted access to end users.
 */

interface StoredAccess {
  dashboardIds: number[];
  reportIds: number[];
  updatedAt: number;
}

function getStorageKey(userId: number, orgId: number | null | undefined): string {
  return `org_insight_access_user_${userId}_org_${orgId ?? "none"}`;
}

export interface AccessibleItem {
  id: number;
  name: string;
}

export interface NewAccessResult {
  newDashboards: AccessibleItem[];
  newReports: AccessibleItem[];
  totalNewCount: number;
}

export function detectNewAccess(
  userId: number,
  orgId: number | null | undefined,
  currentDashboards: AccessibleItem[],
  currentReports: AccessibleItem[]
): NewAccessResult {
  if (typeof window === "undefined" || !userId) {
    return { newDashboards: [], newReports: [], totalNewCount: 0 };
  }

  const key = getStorageKey(userId, orgId);
  const raw = localStorage.getItem(key);

  if (!raw) {
    // First time establishing baseline for this user & org:
    // Store current state so we don't spam notifications on initial login.
    const initial: StoredAccess = {
      dashboardIds: currentDashboards.map((d) => d.id),
      reportIds: currentReports.map((r) => r.id),
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(key, JSON.stringify(initial));
    } catch {
      // Storage unavailable or full
    }
    return { newDashboards: [], newReports: [], totalNewCount: 0 };
  }

  try {
    const parsed: StoredAccess = JSON.parse(raw);
    const knownDashIds = new Set(parsed.dashboardIds || []);
    const knownReportIds = new Set(parsed.reportIds || []);

    const newDashboards = currentDashboards.filter((d) => !knownDashIds.has(d.id));
    const newReports = currentReports.filter((r) => !knownReportIds.has(r.id));

    return {
      newDashboards,
      newReports,
      totalNewCount: newDashboards.length + newReports.length,
    };
  } catch {
    return { newDashboards: [], newReports: [], totalNewCount: 0 };
  }
}

export function acknowledgeAccessItem(
  userId: number,
  orgId: number | null | undefined,
  type: "dashboard" | "report",
  itemId: number
): void {
  if (typeof window === "undefined" || !userId) return;
  const key = getStorageKey(userId, orgId);
  try {
    const raw = localStorage.getItem(key);
    const data: StoredAccess = raw
      ? JSON.parse(raw)
      : { dashboardIds: [], reportIds: [], updatedAt: Date.now() };

    if (type === "dashboard") {
      if (!data.dashboardIds.includes(itemId)) {
        data.dashboardIds.push(itemId);
      }
    } else {
      if (!data.reportIds.includes(itemId)) {
        data.reportIds.push(itemId);
      }
    }
    data.updatedAt = Date.now();
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

export function acknowledgeAllAccess(
  userId: number,
  orgId: number | null | undefined,
  currentDashboards: AccessibleItem[],
  currentReports: AccessibleItem[]
): void {
  if (typeof window === "undefined" || !userId) return;
  const key = getStorageKey(userId, orgId);
  try {
    const updated: StoredAccess = {
      dashboardIds: currentDashboards.map((d) => d.id),
      reportIds: currentReports.map((r) => r.id),
      updatedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}
