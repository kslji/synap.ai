import { platformBase, TOKEN_KEY, isLoopbackHost } from "./config";
import { parseApiError } from "./api";
import { networkOnline } from "./net";

export type UserProfile = {
  id: string;
  email: string;
  email_verified: boolean;
  created_at: string;
};

export class InternetOffError extends Error {
  constructor() {
    super(
      "Internet is off. Sign-in to a remote account waits until you are back online. You can keep chatting with the local host and attached files.",
    );
    this.name = "InternetOffError";
  }
}

function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccount() {
  localStorage.removeItem(TOKEN_KEY);
}

async function postAuth<T>(path: string, body: object): Promise<T> {
  const base = platformBase();
  // Local Small Cloud host works offline — only block remote auth when offline.
  if (!networkOnline() && !isLoopbackHost(base)) throw new InternetOffError();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      isLoopbackHost(base)
        ? `Cannot reach local host at ${base}. Start LOCAL-SETUP on this computer.`
        : `Cannot reach account server at ${base}${path}. Hard-refresh (clear site data for synap.surf) and try again.`,
    );
  }
  if (!res.ok) throw new Error(parseApiError(await res.text()));
  return res.json() as Promise<T>;
}

export async function registerAccount(email: string, password: string) {
  return postAuth<{ ok: boolean; needs_verification: boolean; email: string }>("/v1/auth/register", {
    email,
    password,
  });
}

export async function verifyEmail(email: string, otp: string): Promise<UserProfile> {
  const data = await postAuth<{ token: string; user: UserProfile }>("/v1/auth/verify-email", {
    email,
    otp,
  });
  saveToken(data.token);
  return data.user;
}

export async function loginAccount(email: string, password: string): Promise<UserProfile> {
  const data = await postAuth<{ token: string; user: UserProfile }>("/v1/auth/login", {
    email,
    password,
  });
  saveToken(data.token);
  return data.user;
}

export async function forgotPassword(email: string) {
  return postAuth<{ ok: boolean }>("/v1/auth/forgot", { email });
}

export async function resetPassword(email: string, otp: string, password: string): Promise<UserProfile> {
  const data = await postAuth<{ token: string; user: UserProfile }>("/v1/auth/reset", {
    email,
    otp,
    password,
  });
  saveToken(data.token);
  return data.user;
}

export async function resendOtp(email: string, purpose: "verify" | "reset") {
  return postAuth<{ ok: boolean }>("/v1/auth/resend-otp", { email, purpose });
}

export async function fetchProfile(): Promise<UserProfile | null> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  if (!networkOnline()) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1] || "")) as {
        sub?: string;
        email?: string;
        scope?: string;
      };
      if (payload.scope === "user" && payload.email) {
        return {
          id: String(payload.sub || "offline"),
          email: payload.email,
          email_verified: true,
          created_at: "",
        };
      }
    } catch {
      return null;
    }
    return null;
  }
  const res = await fetch(`${platformBase()}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // Guest/device JWTs cannot call /me — keep them so Moss indexing still works.
    try {
      const payload = JSON.parse(atob(token.split(".")[1] || "")) as { scope?: string };
      if (payload.scope === "user") clearAccount();
    } catch {
      /* ignore */
    }
    return null;
  }
  return res.json() as Promise<UserProfile>;
}
