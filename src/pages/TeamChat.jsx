import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, stream, usePoll } from '../api'
import Avatar from '../Avatar'
import { PageHeader, useTitle } from '../ui'

export default function TeamChat() {
  useTitle('Team chat')
  const [params, setParams] = useSearchParams()
  const id = params.get('id')
  const [agents] = usePoll('/agents', 0)
  const [chats, reload] = usePoll('/meetings?chat=true', 0)
  const [room, setRoom] = useState(null)
  const [selected, setSelected] = useState(() => params.get('agent') ? [Number(params.get('agent'))] : [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [partial, setPartial] = useState(null)
  const [error, setError] = useState('')
  const abort = useRef(null)
  const lock = useRef(false)
  const bottom = useRef(null)
  useEffect(() => {
    let alive = true
    setRoom(null); setPartial(null); setError(''); setText('')
    if (id) api.get(`/meetings/${id}`).then((r) => {
      if (alive) { if (r.kind === 'admin_chat') setRoom(r); else setError('Choose a team chat from the list.') }
    }).catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false; abort.current?.abort() }
  }, [id])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [room?.messages, partial])
  async function create() {
    if (!selected.length || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const r = await api.post('/meetings', { agent_ids: selected, chat: true })
      await reload(); setParams({ id: r.id }); setSelected([])
    } catch (e) { setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  async function send(e) {
    e.preventDefault()
    const message = text.trim()
    if (!message || !room || lock.current) return
    lock.current = true; setBusy(true); setText(''); setError('')
    abort.current = new AbortController()
    setRoom((r) => ({ ...r, messages: [...r.messages, { id: `u-${Date.now()}`, role: 'admin', text: message }] }))
    try {
      await stream(`/meetings/${id}/message`, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: message }) }, (ev) => {
        if (ev.type === 'speaker') setPartial({ agent_id: ev.agent_id, text: '', status: 'Thinking…' })
        if (ev.type === 'token') setPartial((p) => ({ agent_id: ev.agent_id, text: (p?.text || '') + ev.text }))
        if (ev.type === 'tool_start') setPartial((p) => ({ ...p, status: 'Working on your request…' }))
        if (ev.type === 'agent_done') {
          setRoom((r) => ({ ...r, messages: [...r.messages, { id: `a-${Date.now()}-${ev.agent_id}`, role: 'agent', agent_id: ev.agent_id, text: ev.text, tools: ev.tools }] })); setPartial(null)
        }
        if (ev.type === 'agent_pass') setPartial(null)
        if (ev.type === 'error') setError(ev.message)
      }, abort.current.signal)
    } catch (e) { if (e.name !== 'AbortError') setError(e.message) }
    finally { lock.current = false; setBusy(false); setPartial(null) }
  }
  const who = (aid) => room?.agents.find((a) => a.id === aid)?.name || 'Teammate'
  return <div className="page wide">
    <PageHeader title="Team chat" sub="Message your AI teammates. Conversations are saved, and your microphone stays off." />
    {error && <div className="notice" role="alert">{error}</div>}
    <div className="team-chat-layout">
      <aside className="team-chat-list">
        <button className="btn solid" disabled={busy} onClick={() => setParams({})}>New conversation</button>
        {(chats || []).map((c) => <button className={`team-chat-thread ${String(c.id) === id ? 'on' : ''}`} key={c.id} disabled={busy} onClick={() => setParams({ id: c.id })}>{c.title}<small>{new Date(c.created_at * 1000).toLocaleDateString()}</small></button>)}
      </aside>
      <section className="team-chat-room">
        {!id ? <div className="team-chat-start"><h2>Who would you like to chat with?</h2><p className="muted">Choose up to six teammates for a direct or group conversation.</p>
          <div className="team-chat-picks">{(agents || []).map((a) => <label key={a.id}><input type="checkbox" checked={selected.includes(a.id)} disabled={!selected.includes(a.id) && selected.length >= 6} onChange={(e) => setSelected((s) => e.target.checked ? [...s, a.id] : s.filter((i) => i !== a.id))} /><Avatar agent={a} size={32} /><span>{a.name}<small>{a.role}</small></span></label>)}</div>
          {agents?.length === 0 && <p><Link to="/">Add teammates first</Link></p>}
          <button className="btn solid" onClick={create} disabled={busy || !selected.length}>Start chat</button>
        </div> : !room ? <p className="muted">Loading conversation…</p> : <>
          <header><h2>{room.title}</h2><span className="muted small">{room.agents.map((a) => a.name).join(' · ')}</span></header>
          <div className="team-chat-messages" aria-live="polite" aria-relevant="additions text">
            {!room.messages.length && <p className="muted">Say hello, ask a question, or give your team a task.</p>}
            {room.messages.map((m) => <article key={m.id} className={m.role === 'admin' ? 'from-you' : ''}><b>{m.role === 'admin' ? 'You' : who(m.agent_id)}</b><p>{m.text}</p>{m.tools?.length > 0 && <small className="muted">{m.tools.map((t) => t.name.replaceAll('_', ' ')).join(' · ')}</small>}</article>)}
            {partial && <article><b>{who(partial.agent_id)}</b><p>{partial.text || partial.status}</p></article>}
            <div ref={bottom} />
          </div>
          <form onSubmit={send}><textarea aria-label="Message your teammates" placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit() } }} /><button className="btn solid" disabled={busy || !text.trim() || room.status === 'ended'}>{busy ? 'Replying…' : 'Send'}</button></form>
        </>}
      </section>
    </div>
  </div>
}
