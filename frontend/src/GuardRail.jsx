import { useEffect, useRef, useState } from 'react'
import { api } from './api'

const STATUS_COLORS = {
  APPROVED: '#34c759',
  BLOCKED: '#ff3b30',
  ESCROW_CREATED: '#95a4fc',
  ESCROW_RELEASED: '#a8c5da',
}

const REVEAL_MS = 900 // delay between each transaction appearing

function Badge({ label, ok }) {
  return (
    <div className="gr-badge">
      <span className="gr-led" style={{ background: ok ? '#34c759' : '#ff3b30' }} />
      {label}
    </div>
  )
}

function Pill({ status }) {
  const c = STATUS_COLORS[status] || '#8884'
  return (
    <span className="gr-pill" style={{ background: c + '22', color: '#1c1c1c' }}>
      <span className="gr-dot" style={{ background: c }} /> {status}
    </span>
  )
}

function short(s) {
  if (!s) return '—'
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s
}

function Transaction({ e, n }) {
  const accent = STATUS_COLORS[e.status] || '#8884'
  return (
    <div className="gr-tx">
      <div className="gr-accent" style={{ background: accent }} />
      <div className="gr-tx-body">
        <div className="gr-tx-head">
          <span className="gr-tx-num">{n}</span>
          <span className="gr-tx-action">{e.actionType}</span>
          <span className="gr-spacer" />
          <Pill status={e.status} />
        </div>
        <div className="gr-meta">
          <b>{e.amount}</b> → <span className="gr-mono" title={e.to}>{short(e.to)}</span>
        </div>
        <div className="gr-reason">{e.blockReason ? <b style={{ color: accent }}>{e.blockReason}</b> : null} {e.reason}</div>
        {e.txHash && <div className="gr-hash gr-mono">tx {short(e.txHash)}</div>}
      </div>
    </div>
  )
}

export default function GuardRail() {
  const [health, setHealth] = useState(null)
  const [events, setEvents] = useState([])
  const [reveal, setReveal] = useState(0) // how many transactions are visible
  const [summary, setSummary] = useState(null)
  const [llm, setLlm] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const revealingRef = useRef(false)
  const timersRef = useRef([])

  const refreshHealth = () => api.health().then(setHealth).catch(() => setHealth(null))
  const refreshEvents = () =>
    api.events().then((r) => {
      if (revealingRef.current) return // don't fight the staggered reveal
      setEvents(r.events)
      setReveal(r.events.length)
    }).catch(() => {})

  // Live polling: health every 5s, events every 2s for smooth realtime updates.
  useEffect(() => {
    refreshHealth()
    refreshEvents()
    const h = setInterval(refreshHealth, 5000)
    const e = setInterval(refreshEvents, 2000)
    return () => {
      clearInterval(h); clearInterval(e)
      timersRef.current.forEach(clearTimeout)
    }
  }, [])

  async function run() {
    setLoading(true)
    setErr(null)
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    try {
      const r = await api.runDemo()
      setSummary(r.summary)
      setLlm(r.llmOutputs)
      setEvents(r.events)
      // Reveal transactions one-by-one, in narrative order.
      revealingRef.current = true
      setReveal(0)
      r.events.forEach((_, i) => {
        const t = setTimeout(() => {
          setReveal(i + 1)
          if (i + 1 === r.events.length) revealingRef.current = false
        }, REVEAL_MS * (i + 1))
        timersRef.current.push(t)
      })
      refreshHealth()
    } catch (e) {
      setErr(e.message)
      revealingRef.current = false
    } finally {
      setLoading(false)
    }
  }

  const cards = summary
    ? [
        ['Approved', summary.approvedPayments, '#e3f5ff'],
        ['Blocked', summary.blockedPayments, '#ffecec'],
        ['Escrow Ops', summary.escrowOperations, '#e5ecf6'],
        ['Total Events', summary.totalEvents, '#e3f5ff'],
      ]
    : []

  const shown = events.slice(0, reveal)
  const pending = revealingRef.current && reveal < events.length

  return (
    <>
      <h2 className="page-title">GuardRail Pay — AgentVault</h2>

      <div className="panel" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Badge label="Server" ok={!!health} />
            <Badge label="RPC" ok={health?.rpcConnected} />
            <Badge label="Contract" ok={health?.contractConnected} />
            <Badge label="LLM (Ollama)" ok={health?.ollamaConnected} />
          </div>
          <button className="gr-btn" onClick={run} disabled={loading || pending}>
            {loading ? 'Running demo…' : pending ? 'Streaming…' : 'Run Full Demo'}
          </button>
        </div>
        {err && <div style={{ color: '#ff3b30', marginTop: 12 }}>Error: {err}</div>}
      </div>

      {summary && (
        <div className="cards" style={{ marginBottom: 24 }}>
          {cards.map(([title, num, bg]) => (
            <div className="stat" key={title} style={{ background: bg }}>
              <h4>{title}</h4>
              <div className="row"><span className="num">{num}</span></div>
            </div>
          ))}
        </div>
      )}

      <div className="charts">
        <div className="panel">
          <h3>Firewall Decisions {shown.length ? `(${shown.length}/${events.length})` : ''}</h3>
          {events.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No events yet. Run the demo to stream the audit log.</p>
          ) : (
            <div className="gr-tl">
              {shown.map((e, i) => <Transaction key={e.taskId} e={e} n={i + 1} />)}
              {pending && (
                <div className="gr-pending">
                  <span className="gr-dot-pulse" /> Evaluating transaction {reveal + 1}…
                </div>
              )}
            </div>
          )}
        </div>

        <div className="panel">
          <h3>Agent Proposals (LLM)</h3>
          {llm.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>Proposals appear here after a demo run.</p>
          ) : (
            llm.map((o) => (
              <div key={o.scenario} className="gr-prop">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>{o.scenario}</b>
                  <span className="gr-pill" style={{ background: '#e5ecf6' }}>{o.source}</span>
                </div>
                <div className="gr-meta">
                  {o.request.actionType} · {o.request.amount} → <span className="gr-mono">{short(o.request.to)}</span>
                </div>
                <div style={{ marginTop: 4 }}>{o.request.reason}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
