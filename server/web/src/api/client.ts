import type { Source, Target, LogsPage, LogEntry, LogFilters } from '../types'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  const text = await res.text()
  if (!text) return undefined as unknown as T
  return JSON.parse(text) as T
}

export async function login(user: string, pass: string): Promise<void> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, pass }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Invalid credentials')
  }
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
}

export async function getMe(): Promise<{ authed: boolean }> {
  return apiFetch('/api/me')
}

export async function getSources(): Promise<Source[]> {
  return apiFetch('/api/sources')
}

export async function saveSource(source: Source): Promise<Source> {
  const isNew = !source.id
  const url = isNew ? '/api/sources' : `/api/sources/${source.id}`
  return apiFetch(url, {
    method: isNew ? 'POST' : 'PUT',
    body: JSON.stringify(source),
  })
}

export async function deleteSource(id: string): Promise<void> {
  return apiFetch(`/api/sources/${id}`, { method: 'DELETE' })
}

export async function getTargets(): Promise<Target[]> {
  return apiFetch('/api/targets')
}

export async function saveTarget(target: Target, originalId?: string): Promise<Target> {
  const isNew = !originalId
  const url = isNew ? '/api/targets' : `/api/targets/${originalId}`
  return apiFetch(url, {
    method: isNew ? 'POST' : 'PUT',
    body: JSON.stringify(target),
  })
}

export async function deleteTarget(id: string): Promise<void> {
  return apiFetch(`/api/targets/${id}`, { method: 'DELETE' })
}

export interface LogsQuery {
  limit?: number
  offset?: number
  q?: string
  source?: string
  target?: string
}

export async function getLogs(query: LogsQuery): Promise<LogsPage> {
  const params = new URLSearchParams()
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  if (query.q) params.set('q', query.q)
  if (query.source) params.set('source', query.source)
  if (query.target) params.set('target', query.target)
  return apiFetch(`/api/logs?${params.toString()}`)
}

export async function getLog(id: string): Promise<LogEntry> {
  return apiFetch(`/api/logs/${id}`)
}

export async function clearLogs(): Promise<void> {
  return apiFetch('/api/logs', { method: 'DELETE' })
}

export async function getLogFilters(): Promise<LogFilters> {
  return apiFetch('/api/logs/filters')
}
