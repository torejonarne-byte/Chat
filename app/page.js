'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const SELECT =
  'id, room_id, content, created_at, user_id, attachment_url, attachment_name, attachment_kind, profiles(username)';
const MAX_BYTES = 10 * 1024 * 1024;

const toRow = (m) => ({
  id: m.id,
  room_id: m.room_id,
  content: m.content ?? '',
  created_at: m.created_at,
  user_id: m.user_id,
  username: m.username ?? m.profiles?.username ?? 'unknown',
  attachment_url: m.attachment_url,
  attachment_name: m.attachment_name,
  attachment_kind: m.attachment_kind,
});

/* ---------- Top level: logged in or not ---------- */

export default function Home() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <main className="center">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  return session ? <App user={session.user} /> : <AuthForm />;
}

/* ---------- Sign up / log in ---------- */

function AuthForm() {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username: username.trim() } },
      });
      if (error) {
        setError(
          /database error/i.test(error.message)
            ? 'That username is already taken. Pick another one.'
            : error.message
        );
      } else if (!data.session) {
        setNotice('Check your email to confirm your account, then log in.');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setBusy(false);
  }

  const signup = mode === 'signup';

  return (
    <main className="center">
      <form className="auth" onSubmit={submit}>
        <h1>{signup ? 'Create your account' : 'Log in'}</h1>
        <p className="muted">
          {signup
            ? 'Pick a username. It is what others will see next to your messages.'
            : 'Welcome back. Your chats are right where you left them.'}
        </p>

        {signup && (
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]+"
              title="3–20 letters, numbers or underscores"
              autoComplete="username"
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={signup ? 'new-password' : 'current-password'}
          />
        </label>

        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        <button className="primary" disabled={busy}>
          {busy ? 'One moment…' : signup ? 'Create account' : 'Log in'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(signup ? 'login' : 'signup');
            setError('');
            setNotice('');
          }}
        >
          {signup ? 'I already have an account' : 'I need an account'}
        </button>
      </form>
    </main>
  );
}

/* ---------- App shell: chat list + open chat ---------- */

function App({ user }) {
  const [rooms, setRooms] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState('list'); // which pane shows on narrow screens
  const [creating, setCreating] = useState(false);
  const me = user.user_metadata?.username || user.email;

  const loadRooms = useCallback(
    async (selectId) => {
      const { data } = await supabase
        .from('room_members')
        .select('rooms(id, name, is_general)')
        .eq('user_id', user.id);
      const list = (data ?? [])
        .map((r) => r.rooms)
        .filter(Boolean)
        .sort((a, b) => Number(b.is_general) - Number(a.is_general) || a.name.localeCompare(b.name));
      setRooms(list);
      setActiveId((cur) => selectId ?? cur ?? list[0]?.id ?? null);
    },
    [user.id]
  );

  useEffect(() => {
    loadRooms();
    // If someone adds you to a group, it appears in your list right away.
    const channel = supabase
      .channel('my-rooms')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_members', filter: `user_id=eq.${user.id}` },
        () => loadRooms()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadRooms, user.id]);

  const room = rooms.find((r) => r.id === activeId);

  return (
    <div className="app" data-view={view}>
      <aside className="sidebar">
        <div className="side-head">
          <strong>Chats</strong>
          <button className="link" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Cancel' : 'New group'}
          </button>
        </div>

        {creating && (
          <NewGroup
            onCreated={(id) => {
              setCreating(false);
              loadRooms(id);
              setView('room');
            }}
          />
        )}

        <ul className="rooms">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                className={r.id === activeId ? 'room active' : 'room'}
                onClick={() => {
                  setActiveId(r.id);
                  setView('room');
                }}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>

        <div className="side-foot">
          <span className="muted">{me}</span>
          <button className="link" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </aside>

      <section className="main">
        {room ? (
          <Room
            key={room.id}
            user={user}
            room={room}
            onBack={() => setView('list')}
            onLeft={() => {
              setActiveId(null);
              setView('list');
              loadRooms();
            }}
          />
        ) : (
          <p className="empty">Pick a chat to start.</p>
        )}
      </section>
    </div>
  );
}

function NewGroup({ onCreated }) {
  const [name, setName] = useState('');
  const [people, setPeople] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const usernames = people.split(',').map((s) => s.trim()).filter(Boolean);
    const { data, error } = await supabase.rpc('create_group', {
      group_name: name.trim(),
      usernames,
    });
    setBusy(false);
    if (error) setError(error.message);
    else onCreated(data);
  }

  return (
    <form className="newgroup" onSubmit={submit}>
      <label>
        Group name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={50} />
      </label>
      <label>
        Usernames to add
        <input
          value={people}
          onChange={(e) => setPeople(e.target.value)}
          placeholder="sam, alex"
          required
        />
      </label>
      <p className="muted small">Separate usernames with commas. Add one person for a private chat.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}

/* ---------- One open chat ---------- */

function Room({ user, room, onBack, onLeft }) {
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [tick, setTick] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const names = useRef({});
  const endRef = useRef(null);
  const fileRef = useRef(null);

  function add(rows) {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      rows.forEach((r) => map.set(r.id, r));
      return [...map.values()].sort((a, b) => a.id - b.id);
    });
  }

  useEffect(() => {
    let active = true;

    async function load() {
      const { data, error } = await supabase
        .from('messages')
        .select(SELECT)
        .eq('room_id', room.id)
        .order('id', { ascending: false })
        .limit(100);
      if (!active) return;
      if (error) {
        setError(`Could not load messages: ${error.message}`);
        return;
      }
      const rows = data.map(toRow);
      rows.forEach((r) => (names.current[r.user_id] = r.username));
      add(rows);
    }
    load();

    const channel = supabase
      .channel(`room-${room.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${room.id}` },
        async (payload) => {
          const m = payload.new;
          let username = names.current[m.user_id];
          if (!username) {
            const { data } = await supabase
              .from('profiles')
              .select('username')
              .eq('id', m.user_id)
              .single();
            username = data?.username ?? 'unknown';
            names.current[m.user_id] = username;
          }
          if (active) add([toRow({ ...m, username })]);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [room.id]);

  useEffect(() => {
    let active = true;
    supabase
      .from('room_members')
      .select('profiles(username)')
      .eq('room_id', room.id)
      .then(({ data }) => {
        if (active) setMembers((data ?? []).map((r) => r.profiles?.username).filter(Boolean));
      });
    return () => {
      active = false;
    };
  }, [room.id, tick]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  async function post(fields) {
    const { data, error } = await supabase
      .from('messages')
      .insert({ room_id: room.id, ...fields })
      .select(SELECT)
      .single();
    if (error) {
      setError(`Message not sent: ${error.message}`);
      return false;
    }
    add([toRow(data)]);
    return true;
  }

  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setText('');
    setError('');
    if (!(await post({ content }))) setText(content);
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('Files must be 10 MB or smaller.');
      return;
    }
    setError('');
    setUploading(true);
    const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${user.id}/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage
      .from('attachments')
      .upload(path, file, { contentType: file.type || undefined });
    if (error) {
      setUploading(false);
      setError(`Upload failed: ${error.message}`);
      return;
    }
    const { data } = supabase.storage.from('attachments').getPublicUrl(path);
    const caption = text.trim();
    const ok = await post({
      content: caption,
      attachment_url: data.publicUrl,
      attachment_name: file.name,
      attachment_kind: file.type.startsWith('image/') ? 'image' : 'file',
    });
    if (ok) setText('');
    setUploading(false);
  }

  async function pickGif(gif) {
    setGifOpen(false);
    setError('');
    await post({
      content: '',
      attachment_url: gif.url,
      attachment_name: gif.title || 'GIF',
      attachment_kind: 'gif',
    });
  }

  async function addPerson() {
    const name = window.prompt('Username to add to this group');
    if (!name?.trim()) return;
    const { error } = await supabase.rpc('add_member', { rid: room.id, uname: name.trim() });
    if (error) setError(error.message);
    else {
      setError('');
      setTick((t) => t + 1);
    }
  }

  async function leave() {
    if (!window.confirm(`Leave ${room.name}?`)) return;
    const { error } = await supabase
      .from('room_members')
      .delete()
      .eq('room_id', room.id)
      .eq('user_id', user.id);
    if (error) setError('Could not leave the group.');
    else onLeft();
  }

  return (
    <div className="room-view">
      <header>
        <button className="link back" onClick={onBack}>
          Chats
        </button>
        <div className="titles">
          <strong>{room.name}</strong>
          <span className="muted small members">{members.join(', ')}</span>
        </div>
        {!room.is_general && (
          <div className="actions">
            <button className="link" onClick={addPerson}>Add person</button>
            <button className="link" onClick={leave}>Leave</button>
          </div>
        )}
      </header>

      <ol className="messages">
        {messages.length === 0 && !error && (
          <li className="empty">No messages yet. Say hello below.</li>
        )}
        {messages.map((m) => {
          const mine = m.user_id === user.id;
          return (
            <li key={m.id} className={mine ? 'msg mine' : 'msg'}>
              {!mine && <span className="name">{m.username}</span>}
              {m.attachment_url &&
                (m.attachment_kind === 'file' ? (
                  <a className="file" href={m.attachment_url} target="_blank" rel="noreferrer">
                    Download {m.attachment_name}
                  </a>
                ) : (
                  <a href={m.attachment_url} target="_blank" rel="noreferrer">
                    <img
                      className="media"
                      src={m.attachment_url}
                      alt={m.attachment_name || 'Shared image'}
                      loading="lazy"
                    />
                  </a>
                ))}
              {m.content && <div className="bubble">{m.content}</div>}
              <time>
                {new Date(m.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>

      {error && <p className="error bar" role="alert">{error}</p>}
      {uploading && <p className="notice bar">Uploading…</p>}
      {gifOpen && <GifPicker onPick={pickGif} />}

      <form className="composer" onSubmit={send}>
        <input ref={fileRef} type="file" hidden onChange={pickFile} />
        <button
          type="button"
          className="tool"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          Attach
        </button>
        <button
          type="button"
          className="tool"
          onClick={() => setGifOpen((o) => !o)}
          aria-expanded={gifOpen}
        >
          GIF
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message"
          maxLength={2000}
          aria-label="Message"
        />
        <button className="primary" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/* ---------- GIF picker (Giphy, via /api/gifs) ---------- */

function GifPicker({ onPick }) {
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        let res, json;
        try {
          res = await fetch(`/api/gifs?q=${encodeURIComponent(q)}`, {
            headers: { Authorization: `Bearer ${session?.access_token}` },
          });
          json = await res.json();
        } catch {
          if (!cancelled) {
            setLoading(false);
            setGifs([]);
            setStatus('Could not reach GIF search.');
          }
          return;
        }
        if (cancelled) return;
        setLoading(false);
        if (!res.ok) {
          setGifs([]);
          setStatus(json.error || 'GIF search failed.');
        } else {
          setGifs(json.gifs);
          setStatus(json.gifs.length ? '' : 'No GIFs found. Try another search.');
        }
      },
      q ? 350 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <div className="gifpicker">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search GIFs"
        aria-label="Search GIFs"
      />
      {loading && <p className="muted small">Loading…</p>}
      {!loading && status && <p className="muted small">{status}</p>}
      <div className="gifgrid">
        {gifs.map((g) => (
          <button key={g.id} type="button" onClick={() => onPick(g)} title={g.title}>
            <img src={g.preview} alt={g.title || 'GIF'} loading="lazy" />
          </button>
        ))}
      </div>
      <p className="muted small">Powered by GIPHY</p>
    </div>
  );
}
