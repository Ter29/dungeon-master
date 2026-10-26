export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, data?: unknown, method?: 'POST' | 'PATCH' | 'DELETE'): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin',
    ...(data === undefined ? {} : data instanceof FormData ? { method: method ?? 'POST', body: data } : { method: method ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, body.message ?? 'Не вдалося виконати запит.');
  return body as T;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Помилка з’єднання.';
