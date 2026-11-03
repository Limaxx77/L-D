/**
 * Cliente HTTP. Em produção o frontend chama /api no próprio domínio (rewrite da Vercel
 * para o backend), o que mantém os cookies de sessão como primários e seguros.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  participantToken?: string | null;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-LD-Client': 'web' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.participantToken) headers['X-Participant-Token'] = opts.participantToken;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: 'include',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Algo deu errado. Tente novamente.');
  }
  return data as T;
}

export function apiUrl(path: string) {
  return `${BASE}/api${path}`;
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
