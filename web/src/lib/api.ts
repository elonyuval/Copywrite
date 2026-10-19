// Thin fetch wrapper. Every error carries a Hebrew message from the server (or a generic one).
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public data?: any) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body instanceof FormData || body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      ...init,
    })
  } catch {
    throw new ApiError(0, 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.', 'network')
  }
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'unauthenticated') window.dispatchEvent(new Event('auth:lost'))
    throw new ApiError(res.status, data?.error ?? `שגיאה (${res.status}). הפעולה לא הושלמה.`, data?.code, data)
  }
  return data as T
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  upload: <T = any>(url: string, form: FormData) => request<T>('POST', url, form),
}

export const fileUrl = (id: string) => `/api/files/${id}`

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'שגיאה לא צפויה'
}
