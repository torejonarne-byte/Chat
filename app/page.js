'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import './features.css';

const SELECT =
  'id, room_id, content, created_at, user_id, reply_to, attachment_url, attachment_name, attachment_kind, profiles(username)';
const MAX_BYTES = 10 * 1024 * 1024;

const toRow = (m) => ({
  id: m.id,
  room_id: m.room_id,
  content: m.content ?? '',
  created_at: m.created_at,
  user_id: m.user_id,
  username: m.username ?? m.profiles?.username ?? 'unknown',
  reply_to: m.reply_to ?? null,
  reply: m.reply ?? null,
  attachment_url: m.attachment_url,
  attachment_name: m.attachment_name,
  attachment_kind: m.attachment_kind,
});

const snippet = (m) => {
  const kind = m.kind ?? m.attachment_kind;
  const fallback = kind === 'gif' ? 'GIF' : kind === 'image' ? 'Photo' : 'Attachment';
  return (m.content || fallback).toString().slice(0, 90);
};

const attachmentLabel = (kind) => (kind === 'gif' ? 'Sent a GIF' : kind === 'image' ? 'Sent a photo' : 'Sent a file');

/* ---------- Settings (saved in this browser) ---------- */

const ACCENTS = [
  { id: 'fjord', label: 'Fjord blue', color: '#1d5c87' },
  { id: 'plum', label: 'Plum', color: '#7b3f98' },
  { id: 'forest', label: 'Forest', color: '#2e7a4d' },
  { id: 'ember', label: 'Ember', color: '#c2551a' },
  { id: 'rose', label: 'Rose', color: '#b83a5e' },
];

function defaultSettings() {
  let clock24 = true;
  try {
    clock24 = new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12 === false;
  } catch {}
  return {
    theme: 'system',
    accent: 'fjord',
    size: 'md',
    enterSends: true,
    clock24,
    notify: 'all', // 'all' | 'mentions' | 'off'
    sound: true,
    desktop: false,
    muted: [],
  };
}

function loadSettings() {
  const base = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem('chat-settings') || '{}');
    return { ...base, ...saved, muted: Array.isArray(saved.muted) ? saved.muted : [] };
  } catch {
    return base;
  }
}

function applySettings(s) {
  const d = document.documentElement;
  d.dataset.theme = s.theme;
  d.dataset.accent = s.accent;
  d.dataset.size = s.size;
}

function persistRead(map) {
  try {
    localStorage.setItem('chat-read', JSON.stringify(map));
  } catch {}
}

/* ---------- Notification sound (no audio files needed) ---------- */

let audioCtx;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
function ping() {
  try {
    unlockAudio();
    const t = audioCtx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const at = t + i * 0.12;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.25);
    });
  } catch {}
}

const mentions = (text, name) => {
  const clean = (name || '').replace(/[^A-Za-z0-9_]/g, '');
  return clean ? new RegExp(`@${clean}\\b`, 'i').test(text || '') : false;
};

/* ---------- Icons ---------- */

const ICONS = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6L9 17l-5-5" />,
  reply: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  bellOff: (
    <>
      <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5" />
      <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <path d="M2 2l20 20" />
    </>
  ),
  send: (
    <>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </>
  ),
  paperclip: (
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  ),
  gif: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <text x="12" y="15" textAnchor="middle" fontSize="7" fontWeight="700" stroke="none" fill="currentColor">
        GIF
      </text>
    </>
  ),
  settings: (
    <>
      <path d="M3 6h10M17 6h4M3 12h4M11 12h10M3 18h12M19 18h2" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  userPlus: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  file: (
    <>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <path d="M14 2v6h6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
};

function Icon({ name, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

function Avatar({ name, size = 32 }) {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      className="avatar"
      style={{ '--s': `${size}px`, background: `hsl(${hue} 45% 38%)` }}
      aria-hidden="true"
    >
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}

const fmtTime = (iso, clock24) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !clock24 });

// Turns links into clickable links and @names into highlights.
function Rich({ text, me }) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[A-Za-z0-9_]{3,20})/g);
  return parts.map((p, i) => {
    if (/^https?:\/\//.test(p)) {
      return (
        <a key={i} href={p} target="_blank" rel="noreferrer noopener">
          {p}
        </a>
      );
    }
    if (/^@[A-Za-z0-9_]{3,20}$/.test(p)) {
      const mine = p.slice(1).toLowerCase() === (me || '').toLowerCase();
      return (
        <span key={i} className={mine ? 'mention me' : 'mention'}>
          {p}
        </span>
      );
    }
    return p;
  });
}

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

/* ---------- App shell: drawer with chat list + open chat ---------- */

function App({ user }) {
  const [rooms, setRooms] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const [username, setUsername] = useState(user.user_metadata?.username || user.email);
  const [unread, setUnread] = useState({});
  const [toast, setToast] = useState(null);

  // Latest values for use inside long-lived listeners.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activeRef = useRef(null);
  activeRef.current = activeId;
  const roomsRef = useRef([]);
  roomsRef.current = rooms;
  const nameRef = useRef(username);
  nameRef.current = username;
  const nameCache = useRef({});
  const readMap = useRef({});

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    applySettings(s);
  }, []);

  function updateSettings(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    applySettings(next);
    try {
      localStorage.setItem('chat-settings', JSON.stringify(next));
    } catch {}
  }

  function toggleMute(roomId) {
    const muted = settings.muted || [];
    updateSettings({
      muted: muted.includes(roomId) ? muted.filter((id) => id !== roomId) : [...muted, roomId],
    });
  }

  useEffect(() => {
    supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data?.username) setUsername(data.username);
      });
  }, [user.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setDrawer(false);
      }
    };
    const unlock = () => unlockAudio();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', unlock);
    };
  }, []);

  const loadRooms = useCallback(
    async (selectId) => {
      const { data } = await supabase
        .from('room_members')
        .select('rooms(id, name, is_general, slowmode_seconds)')
        .eq('user_id', user.id);
      const list = (data ?? [])
        .map((r) => r.rooms)
        .filter(Boolean)
        .sort((a, b) => Number(b.is_general) - Number(a.is_general) || a.name.localeCompare(b.name));
      setRooms(list);
      setActiveId((cur) => selectId ?? (list.some((r) => r.id === cur) ? cur : list[0]?.id ?? null));
    },
    [user.id]
  );

  useEffect(() => {
    loadRooms();
    // Added to or removed from a group: your list updates right away.
    const channel = supabase
      .channel('my-rooms')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members', filter: `user_id=eq.${user.id}` },
        () => loadRooms()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadRooms, user.id]);

  /* ----- Unread counts ----- */

  const markRead = useCallback((roomId, lastId) => {
    if (lastId == null) return;
    if ((readMap.current[roomId] ?? 0) < lastId) {
      readMap.current[roomId] = lastId;
      persistRead(readMap.current);
    }
    setUnread((u) => (u[roomId] ? { ...u, [roomId]: 0 } : u));
  }, []);

  const roomKey = rooms.map((r) => r.id).join(',');
  useEffect(() => {
    if (!roomKey) return;
    let cancelled = false;
    (async () => {
      try {
        readMap.current = { ...JSON.parse(localStorage.getItem('chat-read') || '{}'), ...readMap.current };
      } catch {}
      const next = {};
      for (const id of roomKey.split(',')) {
        const lastRead = readMap.current[id];
        if (lastRead == null) {
          // First time seeing this chat: treat everything as already read.
          const { data } = await supabase
            .from('messages')
            .select('id')
            .eq('room_id', id)
            .order('id', { ascending: false })
            .limit(1);
          readMap.current[id] = data?.[0]?.id ?? 0;
          next[id] = 0;
        } else {
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('room_id', id)
            .gt('id', lastRead)
            .neq('user_id', user.id);
          next[id] = count ?? 0;
        }
      }
      persistRead(readMap.current);
      if (!cancelled) setUnread(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [roomKey, user.id]);

  /* ----- Notifications for messages in other chats ----- */

  useEffect(() => {
    const channel = supabase
      .channel('all-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const m = payload.new;
        if (m.user_id === user.id) return;
        if (activeRef.current === m.room_id && !document.hidden) return; // you're looking at it

        setUnread((u) => ({ ...u, [m.room_id]: (u[m.room_id] || 0) + 1 }));

        const s = settingsRef.current;
        if (s.notify === 'off' || (s.muted || []).includes(m.room_id)) return;
        if (s.notify === 'mentions') {
          let hit = mentions(m.content, nameRef.current);
          if (!hit && m.reply_to) {
            const { data } = await supabase.from('messages').select('user_id').eq('id', m.reply_to).maybeSingle();
            hit = data?.user_id === user.id;
          }
          if (!hit) return;
        }

        let sender = nameCache.current[m.user_id];
        if (!sender) {
          const { data } = await supabase.from('profiles').select('username').eq('id', m.user_id).single();
          sender = data?.username ?? 'Someone';
          nameCache.current[m.user_id] = sender;
        }
        const roomName = roomsRef.current.find((r) => r.id === m.room_id)?.name ?? 'Chat';
        const body = m.content || attachmentLabel(m.attachment_kind);
        const title = `${sender} in ${roomName}`;

        if (s.sound) ping();
        if (document.hidden) {
          if (s.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              const n = new Notification(title, { body, tag: m.room_id });
              n.onclick = () => {
                window.focus();
                setActiveId(m.room_id);
                n.close();
              };
            } catch {}
          }
        } else {
          setToast({ id: m.id, roomId: m.room_id, title, body });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread > 99 ? '99+' : totalUnread}) Chat` : 'Chat';
  }, [totalUnread]);

  const room = rooms.find((r) => r.id === activeId);
  const othersUnread = Object.entries(unread).some(([id, n]) => n > 0 && id !== activeId);
  const openMenu = () => setDrawer(true);
  const openSettings = () => {
    setDrawer(false);
    setSettingsOpen(true);
  };

  return (
    <div className="app">
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

      <aside className={drawer ? 'drawer open' : 'drawer'} aria-label="Chats" inert={!drawer}>
        <div className="drawer-head">
          <strong>Chats</strong>
          <button className="iconbtn" onClick={() => setDrawer(false)} aria-label="Close chat list">
            <Icon name="close" />
          </button>
        </div>

        <button className="newbtn" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
          <Icon name={creating ? 'close' : 'plus'} size={18} />
          {creating ? 'Cancel' : 'New group'}
        </button>

        {creating && (
          <NewGroup
            onCreated={(id) => {
              setCreating(false);
              setDrawer(false);
              loadRooms(id);
            }}
          />
        )}

        <ul className="rooms">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                className={r.id === activeId ? 'room active' : 'room'}
                aria-current={r.id === activeId ? 'true' : undefined}
                onClick={() => {
                  setActiveId(r.id);
                  setDrawer(false);
                }}
              >
                <Avatar name={r.name} size={36} />
                <span className="rname">{r.name}</span>
                {unread[r.id] > 0 && (
                  <span className="badge" aria-label={`${unread[r.id]} unread`}>
                    {unread[r.id] > 99 ? '99+' : unread[r.id]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="drawer-foot">
          <Avatar name={username} size={36} />
          <div className="who">
            <strong>{username}</strong>
            <span className="muted small">{user.email}</span>
          </div>
          <button className="iconbtn" onClick={openSettings} aria-label="Settings">
            <Icon name="settings" />
          </button>
        </div>
      </aside>

      <main className="main">
        {room ? (
          <Room
            key={room.id}
            user={user}
            room={room}
            settings={settings}
            username={username}
            muted={(settings.muted || []).includes(room.id)}
            dot={othersUnread}
            onToggleMute={() => toggleMute(room.id)}
            onRead={markRead}
            onMenu={openMenu}
            onSettings={openSettings}
            onLeft={() => {
              setActiveId(null);
              setDrawer(true);
              loadRooms();
            }}
          />
        ) : (
          <div className="room-view">
            <TopBar title="Chats" dot={othersUnread} onMenu={openMenu} onSettings={openSettings} />
            <p className="empty">Open the menu to pick a chat.</p>
          </div>
        )}
      </main>

      {toast && (
        <button
          className="toast"
          onClick={() => {
            setActiveId(toast.roomId);
            setToast(null);
          }}
        >
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </button>
      )}

      {settingsOpen && (
        <SettingsDialog
          user={user}
          username={username}
          settings={settings}
          onChange={updateSettings}
          onUsername={setUsername}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function TopBar({ onMenu, onSettings, avatarName, title, subtitle, dot, children }) {
  return (
    <header className="topbar">
      <button className="iconbtn" onClick={onMenu} aria-label={dot ? 'Open chat list (unread messages)' : 'Open chat list'}>
        <Icon name="menu" />
        {dot && <span className="dot" />}
      </button>
      {avatarName && <Avatar name={avatarName} size={36} />}
      <div className="titles">
        <strong>{title}</strong>
        {subtitle && <span className="muted small members">{subtitle}</span>}
      </div>
      {children}
      <button className="iconbtn" onClick={onSettings} aria-label="Settings">
        <Icon name="settings" />
      </button>
    </header>
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

/* ---------- Settings dialog ---------- */

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={18} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="switch">
      <div>
        <strong>{label}</strong>
        {hint && <span className="muted small">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="track"
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function SettingsDialog({ user, username, settings, onChange, onUsername, onClose }) {
  const [name, setName] = useState(username);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  async function saveName(e) {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === username) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from('profiles').update({ username: next }).eq('id', user.id);
    setBusy(false);
    if (error) {
      setMsg({
        type: 'error',
        text: error.code === '23505' ? 'That username is already taken.' : 'Could not change your username.',
      });
    } else {
      onUsername(next);
      setMsg({ type: 'ok', text: 'Username updated.' });
    }
  }

  async function toggleDesktop(on) {
    setHint('');
    if (!on) return onChange({ desktop: false });
    if (typeof Notification === 'undefined') {
      setHint(
        'This browser does not support system notifications. In-app alerts, sounds and unread badges still work.'
      );
      return;
    }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm === 'granted') onChange({ desktop: true });
    else setHint('Notifications are blocked. Allow them for this site in your browser settings.');
  }

  return (
    <div className="dialog-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-head">
          <h2 id="settings-title">Settings</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close settings">
            <Icon name="close" />
          </button>
        </div>

        <section className="setting">
          <h3>Notifications</h3>
          <Segmented
            label="Notify me about"
            value={settings.notify}
            onChange={(notify) => onChange({ notify })}
            options={[
              { value: 'all', label: 'All messages' },
              { value: 'mentions', label: 'Mentions' },
              { value: 'off', label: 'Off' },
            ]}
          />
          <p className="hint">
            Mentions means messages with your @name and replies to you. Mute a single chat with the bell
            icon at the top of it.
          </p>
          <Toggle
            label="Sound"
            checked={settings.sound}
            onChange={(sound) => {
              onChange({ sound });
              if (sound) ping();
            }}
          />
          <Toggle
            label="System notifications"
            hint="Shown when this tab is in the background."
            checked={settings.desktop}
            onChange={toggleDesktop}
          />
          {hint && <p className="hint" role="status">{hint}</p>}
        </section>

        <section className="setting">
          <h3>Theme</h3>
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(theme) => onChange({ theme })}
            options={[
              { value: 'light', label: 'Light', icon: 'sun' },
              { value: 'dark', label: 'Dark', icon: 'moon' },
              { value: 'system', label: 'Auto', icon: 'monitor' },
            ]}
          />
        </section>

        <section className="setting">
          <h3>Accent color</h3>
          <div className="swatches" role="group" aria-label="Accent color">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="swatch"
                style={{ background: a.color }}
                aria-label={a.label}
                aria-pressed={settings.accent === a.id}
                onClick={() => onChange({ accent: a.id })}
              >
                {settings.accent === a.id && <Icon name="check" size={18} />}
              </button>
            ))}
          </div>
        </section>

        <section className="setting">
          <h3>Text size</h3>
          <Segmented
            label="Text size"
            value={settings.size}
            onChange={(size) => onChange({ size })}
            options={[
              { value: 'sm', label: 'Small' },
              { value: 'md', label: 'Medium' },
              { value: 'lg', label: 'Large' },
            ]}
          />
        </section>

        <section className="setting">
          <h3>Chat</h3>
          <Toggle
            label="Enter sends the message"
            hint="Off: Enter starts a new line, and you send with the arrow button."
            checked={settings.enterSends}
            onChange={(enterSends) => onChange({ enterSends })}
          />
          <Toggle
            label="24-hour clock"
            checked={settings.clock24}
            onChange={(clock24) => onChange({ clock24 })}
          />
        </section>

        <section className="setting">
          <h3>Account</h3>
          <form className="namerow" onSubmit={saveName}>
            <label>
              Username
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={3}
                maxLength={20}
                pattern="[A-Za-z0-9_]+"
                title="3–20 letters, numbers or underscores"
                required
              />
            </label>
            <button className="primary" disabled={busy || name.trim() === username}>
              Save
            </button>
          </form>
          {msg && (
            <p className={msg.type === 'error' ? 'error' : 'notice'} role="status">
              {msg.text}
            </p>
          )}
          <p className="muted small">Signed in as {user.email}</p>
          <button className="outline" onClick={() => supabase.auth.signOut()}>
            <Icon name="logout" size={18} />
            Log out
          </button>
        </section>
      </div>
    </div>
  );
}

/* ---------- One open chat ---------- */

function Room({ user, room, settings, username, muted, dot, onToggleMute, onRead, onMenu, onSettings, onLeft }) {
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [tick, setTick] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [block, setBlock] = useState(null); // { until, kind: 'slow' | 'mute' }
  const [, force] = useState(0);
  const [flash, setFlash] = useState(null);
  const names = useRef({});
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef([]);
  messagesRef.current = messages;
  const lastIdRef = useRef(null);

  const remaining = block ? Math.max(0, Math.ceil((block.until - Date.now()) / 1000)) : 0;
  const isBlocked = remaining > 0;

  function add(rows) {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      rows.forEach((r) => map.set(r.id, r));
      return [...map.values()].sort((a, b) => a.id - b.id);
    });
  }

  // Fills in the quoted message for replies.
  async function attachReplies(rows) {
    const known = new Map();
    [...messagesRef.current, ...rows].forEach((x) =>
      known.set(x.id, { id: x.id, username: x.username, content: x.content, kind: x.attachment_kind })
    );
    const missing = [...new Set(rows.filter((r) => r.reply_to && !known.has(r.reply_to)).map((r) => r.reply_to))];
    if (missing.length) {
      const { data } = await supabase
        .from('messages')
        .select('id, content, attachment_kind, profiles(username)')
        .in('id', missing);
      (data ?? []).forEach((x) =>
        known.set(x.id, {
          id: x.id,
          username: x.profiles?.username ?? 'unknown',
          content: x.content,
          kind: x.attachment_kind,
        })
      );
    }
    return rows.map((r) => (r.reply_to ? { ...r, reply: known.get(r.reply_to) ?? null } : r));
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
      const withReplies = await attachReplies(rows);
      if (active) add(withReplies);
    }
    load();

    const channel = supabase
      .channel(`room-${room.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${room.id}` },
        async (payload) => {
          const m = payload.new;
          let uname = names.current[m.user_id];
          if (!uname) {
            const { data } = await supabase
              .from('profiles')
              .select('username')
              .eq('id', m.user_id)
              .single();
            uname = data?.username ?? 'unknown';
            names.current[m.user_id] = uname;
          }
          const [row] = await attachReplies([toRow({ ...m, username: uname })]);
          if (active) add([row]);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Mark this chat as read while you can see it.
  const lastId = messages[messages.length - 1]?.id;
  lastIdRef.current = lastId;
  useEffect(() => {
    if (lastId != null && !document.hidden) onRead(room.id, lastId);
  }, [lastId, room.id, onRead]);
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && lastIdRef.current != null) onRead(room.id, lastIdRef.current);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [room.id, onRead]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  // Countdown for slowmode / spam mute.
  useEffect(() => {
    if (!block) return;
    const t = setInterval(() => {
      if (Date.now() >= block.until) {
        setBlock(null);
        setError((e) => (/spam|muted|slowmode/i.test(e) ? '' : e));
      } else force((n) => n + 1);
    }, 250);
    return () => clearInterval(t);
  }, [block]);

  async function post(fields) {
    const { data, error } = await supabase.rpc('send_message', {
      rid: room.id,
      body: fields.content ?? '',
      att_url: fields.attachment_url ?? null,
      att_name: fields.attachment_name ?? null,
      att_kind: fields.attachment_kind ?? null,
      reply_id: replyTo?.id ?? null,
    });
    if (error) {
      setError(error.code === 'P0001' ? error.message : `Message not sent: ${error.message}`);
      return false;
    }
    if (data?.error) {
      setError(data.error);
      if (data.wait) setBlock({ until: Date.now() + data.wait * 1000, kind: data.kind });
      return false;
    }
    add([
      toRow({
        ...data,
        username,
        reply: replyTo
          ? { id: replyTo.id, username: replyTo.username, content: replyTo.content, kind: replyTo.attachment_kind }
          : null,
      }),
    ]);
    setReplyTo(null);
    if (room.slowmode_seconds > 0) setBlock({ until: Date.now() + room.slowmode_seconds * 1000, kind: 'slow' });
    return true;
  }

  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content || isBlocked) return;
    setText('');
    setError('');
    inputRef.current?.focus();
    if (!(await post({ content }))) setText(content);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && settings.enterSends && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (isBlocked) {
      setError('Wait a moment before sending again.');
      return;
    }
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
    if (isBlocked) {
      setError('Wait a moment before sending again.');
      return;
    }
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

  function jumpTo(id) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(id);
    setTimeout(() => setFlash(null), 1400);
  }

  const close = (a, b) =>
    a && b && a.user_id === b.user_id && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < 5 * 60 * 1000;

  return (
    <div className="room-view">
      <TopBar
        onMenu={onMenu}
        onSettings={onSettings}
        dot={dot}
        avatarName={room.name}
        title={room.name}
        subtitle={members.join(', ')}
      >
        <button
          className="iconbtn"
          onClick={onToggleMute}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute this chat' : 'Mute this chat'}
        >
          <Icon name={muted ? 'bellOff' : 'bell'} />
        </button>
        {!room.is_general && (
          <>
            <button className="iconbtn" onClick={addPerson} aria-label="Add person">
              <Icon name="userPlus" />
            </button>
            <button className="iconbtn" onClick={leave} aria-label="Leave group">
              <Icon name="logout" />
            </button>
          </>
        )}
      </TopBar>

      <ol className="messages">
        {messages.length === 0 && !error && (
          <li className="empty">No messages yet. Say hello below.</li>
        )}
        {messages.map((m, i) => {
          const mine = m.user_id === user.id;
          const first = !close(messages[i - 1], m);
          const last = !close(m, messages[i + 1]);
          return (
            <li
              key={m.id}
              id={`msg-${m.id}`}
              className={`row${mine ? ' mine' : ''}${first ? '' : ' tight'}${flash === m.id ? ' flash' : ''}`}
            >
              {!mine && (first ? <Avatar name={m.username} /> : <span className="spacer" />)}
              <div className="msg">
                {!mine && first && <span className="name">{m.username}</span>}
                {m.reply_to &&
                  (m.reply ? (
                    <button className="quote" onClick={() => jumpTo(m.reply.id)}>
                      <strong>{m.reply.username}</strong>
                      <span>{snippet(m.reply)}</span>
                    </button>
                  ) : (
                    <span className="quote gone">Original message unavailable</span>
                  ))}
                {m.attachment_url &&
                  (m.attachment_kind === 'file' ? (
                    <a className="file" href={m.attachment_url} target="_blank" rel="noreferrer">
                      <Icon name="file" size={20} />
                      <span>{m.attachment_name}</span>
                      <Icon name="download" size={18} />
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
                {m.content && (
                  <div className="bubble">
                    <Rich text={m.content} me={username} />
                  </div>
                )}
                {last && <time>{fmtTime(m.created_at, settings.clock24)}</time>}
              </div>
              <button
                className="act"
                onClick={() => {
                  setReplyTo(m);
                  inputRef.current?.focus();
                }}
                aria-label={`Reply to ${m.username}`}
              >
                <Icon name="reply" size={18} />
              </button>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>

      {error && <p className="error bar" role="alert">{error}</p>}
      {block?.kind === 'mute' && isBlocked && (
        <p className="notice bar" role="status">
          You are muted for {remaining}s.
        </p>
      )}
      {uploading && <p className="notice bar">Uploading…</p>}
      {gifOpen && <GifPicker onPick={pickGif} />}

      {replyTo && (
        <div className="replybar">
          <div>
            <strong>Replying to {replyTo.username}</strong>
            <span>{snippet(replyTo)}</span>
          </div>
          <button className="iconbtn" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      <form className="composer" onSubmit={send}>
        <input ref={fileRef} type="file" hidden onChange={pickFile} />
        <button
          type="button"
          className="iconbtn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label="Attach a file"
        >
          <Icon name="paperclip" />
        </button>
        <button
          type="button"
          className={gifOpen ? 'iconbtn on' : 'iconbtn'}
          onClick={() => setGifOpen((o) => !o)}
          aria-expanded={gifOpen}
          aria-label="Add a GIF"
        >
          <Icon name="gif" />
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message"
          maxLength={2000}
          aria-label="Message"
          enterKeyHint={settings.enterSends ? 'send' : 'enter'}
        />
        <button className="send" disabled={!text.trim() || isBlocked} aria-label="Send message">
          <Icon name="send" size={20} />
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
