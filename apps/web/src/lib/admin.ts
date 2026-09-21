import { platformBase } from "./config";

const ADMIN_TOKEN_KEY = "surf.admin.token";
const REF_KEY = "surf.referral";

export function getReferralCode(): string {
  if (typeof window === "undefined") return "";
  try {
    const q = new URLSearchParams(window.location.search).get("ref");
    if (q && /^[a-zA-Z0-9_-]{4,32}$/.test(q)) {
      localStorage.setItem(REF_KEY, q.toLowerCase());
      return q.toLowerCase();
    }
    return (localStorage.getItem(REF_KEY) || "").toLowerCase();
  } catch {
    return "";
  }
}

export function captureReferralFromUrl(): void {
  void getReferralCode();
}

export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (!token) localStorage.removeItem(ADMIN_TOKEN_KEY);
    else localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export type AdminStats = {
  totals: { users: number; verified: number; logins: number; signups: number };
  models: Array<{ label: string; clicks: number }>;
  agents: Array<{ label: string; clicks: number }>;
  downloads: Array<{ label: string; clicks: number }>;
  referrals: Array<{ code: string; users: number }>;
  recent_users: Array<{
    email: string;
    email_verified: boolean;
    created_at: string;
    referred_by: string | null;
    referral_code: string | null;
  }>;
};

export async function adminLogin(email: string, password: string) {
  const res = await fetch(`${platformBase()}/v1/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Admin sign-in failed");
  setAdminToken(data.token);
  return data as {
    token: string;
    email: string;
    referral_code: string;
    referral_path: string;
  };
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const token = getAdminToken();
  const res = await fetch(`${platformBase()}/v1/admin/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Could not load admin stats");
  return res.json();
}

export async function fetchAdminMe() {
  const token = getAdminToken();
  const res = await fetch(`${platformBase()}/v1/admin/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Admin session expired");
  return res.json() as Promise<{ email: string; referral_code: string; referral_path: string }>;
}

export async function trackEvent(
  kind: "model_click" | "agent_click" | "download",
  label: string,
): Promise<void> {
  try {
    await fetch(`${platformBase()}/v1/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        label,
        referral_code: getReferralCode() || null,
      }),
    });
  } catch {
    /* analytics must never block UX */
  }
}
