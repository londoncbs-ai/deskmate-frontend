import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, stream, usePoll } from '../api'
import Avatar from '../Avatar'
import { useTitle } from '../ui'

export default function TeamChat() {
  useTitle('Team chat')
  const [params, setParams] = useSearchParams()
  const id = params.get('id')
  const [agents] = usePoll('/agents', 0)
  const [chats, reload] = usePoll('/meetings?chat=true', 0)
  const [room, setRoom] = useState(null)
  const [filter, setFilter] = useState('')
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
  const filteredChats = (chats || []).filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
  return <div className="page wide team-chat-page">
    <div className="team-chat-layout">
      <aside className="team-chat-list">
        <div className="team-chat-list-head"><div><span className="team-chat-kicker">WORKSPACE</span><h1>Team chat</h1><p>Talk with your AI teammates.</p></div><button className="team-chat-new" disabled={busy} onClick={() => { setSelected([]); setParams({}) }} aria-label="New conversation" title="New conversation">＋</button></div>
        <label className="team-chat-search"><span>⌕</span><input aria-label="Search conversations" placeholder="Search conversations" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        <div className="team-chat-list-label">RECENT</div>
        <div className="team-chat-threads">
          {filteredChats.map((c) => <button className={`team-chat-thread ${String(c.id) === id ? 'on' : ''}`} key={c.id} disabled={busy} onClick={() => setParams({ id: c.id })}><span className="team-chat-thread-avatar">{c.title.replace(/^Chat: /, '').split(/[ ,]/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()}</span><span className="team-chat-thread-copy"><b>{c.title.replace(/^Chat: /, '')}</b><small>{new Date(c.created_at * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></span><span className="team-chat-chevron">›</span></button>)}
          {!filteredChats.length && <p className="team-chat-no-threads">{filter ? 'No matching conversations.' : 'Your conversations will appear here.'}</p>}
        </div>
        <div className="team-chat-privacy"><span className="team-chat-lock">⌑</span><span><b>Private team space</b><small>Only you and selected teammates can see these messages.</small></span></div>
      </aside>
      <section className="team-chat-room">
        {!id ? <div className="team-chat-start"><span className="team-chat-start-mark">✳</span><span className="team-chat-kicker">A QUIETER WAY TO WORK</span><h2>Good work starts with a conversation.</h2><p className="muted">Choose teammates and start a saved text conversation. Your microphone stays off.</p>
          <div className="team-chat-picks">{(agents || []).map((a) => <label key={a.id}><input type="checkbox" checked={selected.includes(a.id)} disabled={!selected.includes(a.id) && selected.length >= 6} onChange={(e) => setSelected((s) => e.target.checked ? [...s, a.id] : s.filter((i) => i !== a.id))} /><Avatar agent={a} size={32} /><span>{a.name}<small>{a.role}</small></span></label>)}</div>
          {agents?.length === 0 && <p><Link to="/">Add teammates first</Link></p>}
          <button className="btn solid" onClick={create} disabled={busy || !selected.length}>Start chat</button>
        </div> : !room ? <div className="team-chat-loading"><i /><span>Opening conversation</span></div> : <>
          <header className="team-chat-room-head"><div className="team-chat-room-people">{room.agents.slice(0, 3).map((a) => <Avatar key={a.id} agent={a} size={38} />)}</div><div className="team-chat-room-title"><h2>{room.title.replace(/^Chat: /, '')}</h2><span>{room.agents.map((a) => a.name).join(' · ')}</span></div><span className="team-chat-saved"><i /> Saved</span></header>
          <div className="team-chat-messages" aria-live="polite" aria-relevant="additions text">
            {!room.messages.length && <div className="team-chat-empty"><span className="team-chat-start-mark">✳</span><h3>Start the conversation</h3><p>Ask a question, share context, or talk through what you need.</p></div>}
            {room.messages.map((m, i) => <article key={m.id} className={`team-chat-message ${m.role === 'admin' ? 'from-you' : ''}`}><div className="team-chat-message-meta"><b>{m.role === 'admin' ? 'You' : who(m.agent_id)}</b><time>{i === room.messages.length - 1 ? 'Just now' : ''}</time></div><p>{m.text}</p>{m.tools?.length > 0 && <small className="team-chat-tools">↗ {m.tools.map((t) => t.name.replaceAll('_', ' ')).join(' · ')}</small>}</article>)}
            {partial && <article className="team-chat-message"><div className="team-chat-message-meta"><b>{who(partial.agent_id)}</b></div><p>{partial.text || <span className="team-chat-typing"><i/><i/><i/> {partial.status}</span>}</p></article>}
            <div ref={bottom} />
          </div>
          <form className="team-chat-compose" onSubmit={send}><div className="team-chat-compose-box"><textarea aria-label="Message your teammates" placeholder={room.status === 'ended' ? 'This conversation has ended' : 'Message your teammates…'} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} disabled={busy || room.status === 'ended'} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit() } }} /><div className="team-chat-compose-foot"><span>Enter to send · Shift + Enter for a new line</span><button className="team-chat-send" disabled={busy || !text.trim() || room.status === 'ended'} aria-label="Send message">{busy ? '…' : '↑'}</button></div></div></form>
        </>}
      </section>
    </div>
  </div>
}
