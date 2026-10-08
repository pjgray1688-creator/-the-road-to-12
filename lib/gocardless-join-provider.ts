export type GoCardlessRedirectFlow = {
  id: string;
  redirect_url?: string;
  confirmation_url?: string;
  links?: { mandate?: string; customer?: string; customer_bank_account?: string };
};

export type GoCardlessMandate = { id: string; status: "pending_submission" | "submitted" | "active" | "failed" | "cancelled" | "expired" | "consumed" };

function configuration() {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  const environment = process.env.GOCARDLESS_ENVIRONMENT ?? "sandbox";
  if (!token) throw new Error("Direct Debit setup is not configured");
  if (!['sandbox', 'live'].includes(environment)) throw new Error("GoCardless environment must be sandbox or live");
  return { token, baseUrl: environment === "live" ? "https://api.gocardless.com" : "https://api-sandbox.gocardless.com" };
}

async function request<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const { token, baseUrl } = configuration();
  const response = await fetcher(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "GoCardless-Version": "2015-07-06",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const value = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(value.error?.message || "GoCardless request failed");
  return value;
}

export async function retrieveGoCardlessRedirectFlow(id: string, fetcher?: typeof fetch) {
  const value = await request<{ redirect_flows: GoCardlessRedirectFlow }>(`/redirect_flows/${encodeURIComponent(id)}`, {}, fetcher);
  return value.redirect_flows;
}

export async function createGoCardlessRedirectFlow(input: { requestId: string; generation: number; sessionToken: string; description: string; successUrl: string }, fetcher?: typeof fetch) {
  const value = await request<{ redirect_flows: GoCardlessRedirectFlow }>("/redirect_flows", {
    method: "POST",
    headers: { "Idempotency-Key": `r12-join-${input.requestId}-mandate-${input.generation}` },
    body: JSON.stringify({ redirect_flows: { description: input.description, session_token: input.sessionToken, success_redirect_url: input.successUrl } }),
  }, fetcher);
  return value.redirect_flows;
}

export async function completeGoCardlessRedirectFlow(id: string, sessionToken: string, fetcher?: typeof fetch) {
  const value = await request<{ redirect_flows: GoCardlessRedirectFlow }>(`/redirect_flows/${encodeURIComponent(id)}/actions/complete`, {
    method: "POST", body: JSON.stringify({ data: { session_token: sessionToken } }),
  }, fetcher);
  return value.redirect_flows;
}

export async function retrieveGoCardlessMandate(id: string, fetcher?: typeof fetch) {
  const value = await request<{ mandates: GoCardlessMandate }>(`/mandates/${encodeURIComponent(id)}`, {}, fetcher);
  return value.mandates;
}
