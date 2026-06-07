const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

async function getJson(path, init) {
  const res = await fetch(`${BASE}${path}`, init)
  const body = await res.json()
  if (!res.ok || body.ok === false) {
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return body
}

export const api = {
  health: () => getJson('/health'),
  events: (q = {}) => {
    const qs = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]),
    ).toString()
    return getJson(`/events${qs ? `?${qs}` : ''}`)
  },
  runDemo: () => getJson('/demo/full-run', { method: 'POST' }),
}
