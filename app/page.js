'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import './features.css';

const SELECT =
  'id, room_id, content, created_at, user_id, reply_to, attachment_url, attachment_name, attachment_kind, profiles(username)';
const MAX_BYTES = 10 * 1024 * 1024;
const PAGE = 40;

// Messages already loaded per chat, so switching chats feels instant.
const roomCache = new Map();

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
    bg: 'none',
    bgColor: '#1d5c87',
    bgFade: 35,
    tabTitle: 'Chat',
    tabEmoji: '',
    tabImage: false,
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

/* ---------- Chat backgrounds ---------- */

const BG_PRESETS = [
  { id: 'none', label: 'Plain', css: null },
  {
    id: 'accent',
    label: 'Accent',
    css: 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 30%, var(--surface)), var(--surface))',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    css: 'linear-gradient(160deg, color-mix(in srgb, #1d5c87 38%, var(--surface)), color-mix(in srgb, #7b3f98 34%, var(--surface)))',
  },
  {
    id: 'sunset',
    label: 'Sunset',
    css: 'linear-gradient(160deg, color-mix(in srgb, #c2551a 34%, var(--surface)), color-mix(in srgb, #b83a5e 34%, var(--surface)))',
  },
  {
    id: 'forest',
    label: 'Forest',
    css: 'linear-gradient(160deg, color-mix(in srgb, #2e7a4d 38%, var(--surface)), color-mix(in srgb, #1d7f8a 30%, var(--surface)))',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    css: 'linear-gradient(180deg, color-mix(in srgb, #2a8fd4 30%, var(--surface)), color-mix(in srgb, #1d3f7a 38%, var(--surface)))',
  },
  {
    id: 'mist',
    label: 'Mist',
    css: 'linear-gradient(180deg, color-mix(in srgb, var(--ink) 6%, var(--surface)), color-mix(in srgb, var(--ink) 14%, var(--surface)))',
  },
  {
    id: 'dots',
    label: 'Dots',
    css: 'radial-gradient(color-mix(in srgb, var(--ink) 16%, transparent) 1.5px, transparent 1.6px)',
    size: '20px 20px',
  },
  {
    id: 'grid',
    label: 'Grid',
    css: 'linear-gradient(color-mix(in srgb, var(--ink) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--ink) 9%, transparent) 1px, transparent 1px)',
    size: '24px 24px',
  },
  {
    id: 'stripes',
    label: 'Stripes',
    css: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 7%, transparent) 0 10px, transparent 10px 20px)',
  },
];

function bgStyle(s, image) {
  if (s.bg === 'image' && image) {
    const fade = Math.round(Number(s.bgFade ?? 35));
    const veil = `color-mix(in srgb, var(--surface) ${fade}%, transparent)`;
    return {
      backgroundImage: `linear-gradient(${veil}, ${veil}), url("${image}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  if (s.bg === 'color') return { backgroundColor: s.bgColor };
  const preset = BG_PRESETS.find((x) => x.id === s.bg);
  if (preset?.css) return { backgroundImage: preset.css, backgroundSize: preset.size };
  return {};
}

/* ---------- Tab name and icon, stored images ---------- */

const TAB_EMOJIS = ['💬', '🔥', '⭐', '🎮', '🌙', '🍀', '⚡', '🐱'];

function getStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStored(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function firstGrapheme(str) {
  const text = (str || '').trim();
  if (!text) return '';
  try {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)][0].segment;
  } catch {
    return Array.from(text)[0];
  }
}

function emojiIcon(emoji) {
  const safe = emoji.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${safe}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function applyTab(s, iconData, unreadCount) {
  const base = (s.tabTitle || '').trim() || 'Chat';
  document.title = unreadCount > 0 ? `(${unreadCount > 99 ? '99+' : unreadCount}) ${base}` : base;
  document.querySelectorAll('link[data-custom-icon]').forEach((l) => l.remove());
  const href = s.tabImage && iconData ? iconData : s.tabEmoji ? emojiIcon(s.tabEmoji) : null;
  if (href) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = href;
    link.setAttribute('data-custom-icon', '1');
    document.head.appendChild(link);
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

async function resizeImage(file, { maxSide, quality, square, type }) {
  const img = await loadImage(file);
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  let sx = 0;
  let sy = 0;
  if (square) {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2;
    sy = (sh - side) / 2;
    sw = side;
    sh = side;
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return canvas.toDataURL(type, quality);
}

// Big photos are shrunk before upload so they send and load much faster.
async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || /gif|svg/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
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
  refresh: (
    <>
      <path d="M21 2v6h-6" />
      <path d="M21 13a9 9 0 1 1-3-7.7L21 8" />
    </>
  ),
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
  megaphone: (
    <>
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
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

function RoomAvatar({ room, size = 36 }) {
  if (room.is_announcement) {
    return (
      <span className="avatar" style={{ '--s': `${size}px`, background: 'var(--accent)' }} aria-hidden="true">
        <Icon name="megaphone" size={Math.round(size * 0.5)} />
      </span>
    );
  }
  return <Avatar name={room.name} size={size} />;
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
    applyTab(loadSettings(), getStored('chat-tab-icon'), 0);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s) roomCache.clear();
      setSession(s);
    });
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [bgImage, setBgImage] = useState(null);
  const [tabIcon, setTabIcon] = useState(null);
  const [online, setOnline] = useState(() => new Set());

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
  const busRef = useRef(new Set()); // open chats subscribe here for live messages

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    applySettings(s);
    setBgImage(getStored('chat-bg-image'));
    setTabIcon(getStored('chat-tab-icon'));
  }, []);

  function updateSettings(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    applySettings(next);
    try {
      localStorage.setItem('chat-settings', JSON.stringify(next));
    } catch {}
  }

  function saveBgImage(data) {
    const ok = setStored('chat-bg-image', data);
    if (ok) setBgImage(data);
    return ok;
  }

  function saveTabIcon(data) {
    const ok = setStored('chat-tab-icon', data);
    if (ok) setTabIcon(data);
    return ok;
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
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
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

  // Who is online right now.
  useEffect(() => {
    const channel = supabase.channel('online', { config: { presence: { key: user.id } } });
    channel
      .on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(channel.presenceState()))))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ at: Date.now() });
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  const loadRooms = useCallback(
    async (selectId) => {
      const { data } = await supabase
        .from('room_members')
        .select('rooms(id, name, is_general, is_announcement, slowmode_seconds)')
        .eq('user_id', user.id);
      const list = (data ?? [])
        .map((r) => r.rooms)
        .filter(Boolean)
        .sort(
          (a, b) =>
            Number(b.is_announcement) - Number(a.is_announcement) ||
            Number(b.is_general) - Number(a.is_general) ||
            a.name.localeCompare(b.name)
        );
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
      // All chats are checked at the same time.
      const entries = await Promise.all(
        roomKey.split(',').map(async (id) => {
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
            return [id, 0];
          }
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('room_id', id)
            .gt('id', lastRead)
            .neq('user_id', user.id);
          return [id, count ?? 0];
        })
      );
      persistRead(readMap.current);
      if (!cancelled) setUnread(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [roomKey, user.id]);

  /* ----- One live connection for every message ----- */

  useEffect(() => {
    const channel = supabase
      .channel('all-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const m = payload.new;
        busRef.current.forEach((fn) => fn(m)); // the open chat shows it
        if (m.user_id === user.id) return;
        if (activeRef.current === m.room_id && !document.hidden) return; // you're looking at it

        setUnread((u) => ({ ...u, [m.room_id]: (u[m.room_id] || 0) + 1 }));

        const s = settingsRef.current;
        if (s.notify === 'off' || (s.muted || []).includes(m.room_id)) return;
        const roomInfo = roomsRef.current.find((r) => r.id === m.room_id);
        const isAnnouncement = !!roomInfo?.is_announcement;
        if (s.notify === 'mentions' && !isAnnouncement) {
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
        const roomName = roomInfo?.name ?? 'Chat';
        const body = m.content || attachmentLabel(m.attachment_kind);
        const title = isAnnouncement ? 'New announcement' : `${sender} in ${roomName}`;

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
    applyTab(settings, tabIcon, totalUnread);
  }, [settings.tabTitle, settings.tabEmoji, settings.tabImage, tabIcon, totalUnread]);

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
                <RoomAvatar room={r} size={36} />
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
            isAdmin={isAdmin}
            bgImage={bgImage}
            online={online}
            busRef={busRef}
            onToggleMute={() => toggleMute(room.id)}
            onRead={markRead}
            onRefresh={() => loadRooms()}
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
          bgImage={bgImage}
          tabIcon={tabIcon}
          onChange={updateSettings}
          onBgImage={saveBgImage}
          onTabIcon={saveTabIcon}
          onUsername={setUsername}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function TopBar({ onMenu, onSettings, avatar, title, subtitle, onSubtitle, dot, children }) {
  return (
    <header className="topbar">
      <button className="iconbtn" onClick={onMenu} aria-label={dot ? 'Open chat list (unread messages)' : 'Open chat list'}>
        <Icon name="menu" />
        {dot && <span className="dot" />}
      </button>
      {avatar}
      <div className="titles">
        <strong>{title}</strong>
        {subtitle &&
          (onSubtitle ? (
            <button className="subtitle" onClick={onSubtitle}>
              {subtitle}
            </button>
          ) : (
            <span className="muted small members">{subtitle}</span>
          ))}
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

function SettingsDialog({
  user,
  username,
  settings,
  bgImage,
  tabIcon,
  onChange,
  onBgImage,
  onTabIcon,
  onUsername,
  onClose,
}) {
  const [name, setName] = useState(username);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [bgMsg, setBgMsg] = useState('');
  const [tabMsg, setTabMsg] = useState('');
  const bgFile = useRef(null);
  const iconFile = useRef(null);

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

  async function pickBg(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBgMsg('');
    try {
      let data = await resizeImage(file, { maxSide: 1600, quality: 0.8, type: 'image/jpeg' });
      if (data.length > 1500000) {
        data = await resizeImage(file, { maxSide: 1100, quality: 0.7, type: 'image/jpeg' });
      }
      if (onBgImage(data)) onChange({ bg: 'image' });
      else setBgMsg('That image is too big for this browser to store. Try a smaller one.');
    } catch {
      setBgMsg('Could not read that image.');
    }
  }

  function removeBg() {
    onBgImage(null);
    if (settings.bg === 'image') onChange({ bg: 'none' });
  }

  async function pickIcon(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTabMsg('');
    try {
      const data = await resizeImage(file, { maxSide: 64, square: true, type: 'image/png' });
      if (onTabIcon(data)) onChange({ tabImage: true, tabEmoji: '' });
      else setTabMsg('Could not save that icon in this browser.');
    } catch {
      setTabMsg('Could not read that image.');
    }
  }

  function resetTab() {
    onTabIcon(null);
    onChange({ tabTitle: 'Chat', tabEmoji: '', tabImage: false });
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
            Mentions means messages with your @name and replies to you. Announcements always notify. Mute a
            single chat from the three-dot menu at the top of it.
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
          <h3>Chat background</h3>
          <div className="bgtiles">
            {BG_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="bgtile"
                aria-pressed={settings.bg === p.id}
                style={bgStyle({ ...settings, bg: p.id }, bgImage)}
                onClick={() => onChange({ bg: p.id })}
              >
                <span>{p.label}</span>
              </button>
            ))}
            <label
              className={settings.bg === 'color' ? 'bgtile on' : 'bgtile'}
              style={{ backgroundColor: settings.bgColor }}
            >
              <input
                type="color"
                value={settings.bgColor}
                onChange={(e) => onChange({ bg: 'color', bgColor: e.target.value })}
                aria-label="Custom background color"
              />
              <span>Color</span>
            </label>
            {bgImage && (
              <button
                type="button"
                className="bgtile"
                aria-pressed={settings.bg === 'image'}
                style={bgStyle({ ...settings, bg: 'image', bgFade: 0 }, bgImage)}
                onClick={() => onChange({ bg: 'image' })}
              >
                <span>Your image</span>
              </button>
            )}
          </div>
          <input ref={bgFile} type="file" accept="image/*" hidden onChange={pickBg} />
          <div className="btnrow">
            <button type="button" className="outline" onClick={() => bgFile.current?.click()}>
              <Icon name="image" size={18} />
              {bgImage ? 'Change image' : 'Upload image'}
            </button>
            {bgImage && (
              <button type="button" className="outline" onClick={removeBg}>
                Remove image
              </button>
            )}
          </div>
          {settings.bg === 'image' && bgImage && (
            <label>
              Image fade
              <input
                className="range"
                type="range"
                min="0"
                max="80"
                value={settings.bgFade}
                onChange={(e) => onChange({ bgFade: Number(e.target.value) })}
              />
            </label>
          )}
          {bgMsg && <p className="error" role="alert">{bgMsg}</p>}
          <p className="hint">Backgrounds are saved on this device only. Nobody else sees yours.</p>
        </section>

        <section className="setting">
          <h3>Tab name and icon</h3>
          <label>
            Tab name
            <input
              value={settings.tabTitle}
              onChange={(e) => onChange({ tabTitle: e.target.value })}
              maxLength={30}
              placeholder="Chat"
            />
          </label>
          <div className="emojis" role="group" aria-label="Tab icon">
            {TAB_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                aria-pressed={!settings.tabImage && settings.tabEmoji === em}
                aria-label={`Use ${em} as the tab icon`}
                onClick={() => onChange({ tabEmoji: em, tabImage: false })}
              >
                {em}
              </button>
            ))}
          </div>
          <label>
            Or type any emoji
            <input
              value={settings.tabImage ? '' : settings.tabEmoji}
              onChange={(e) => onChange({ tabEmoji: firstGrapheme(e.target.value), tabImage: false })}
              maxLength={12}
              placeholder="🙂"
            />
          </label>
          <input ref={iconFile} type="file" accept="image/*" hidden onChange={pickIcon} />
          <div className="btnrow">
            <button type="button" className="outline" onClick={() => iconFile.current?.click()}>
              <Icon name="image" size={18} />
              Upload image icon
            </button>
            <button type="button" className="outline" onClick={resetTab}>
              Reset
            </button>
            {settings.tabImage && tabIcon && <img className="iconprev" src={tabIcon} alt="Your tab icon" />}
          </div>
          {tabMsg && <p className="error" role="alert">{tabMsg}</p>}
          <p className="hint">This only changes how the tab looks in your own browser.</p>
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

/* ---------- People list ---------- */

function PeopleDialog({ room, userId, members, online, canMention, onMention, onClose }) {
  const [tab, setTab] = useState('chat');
  const [everyone, setEveryone] = useState(null);

  useEffect(() => {
    if (tab !== 'everyone' || everyone) return;
    supabase
      .from('profiles')
      .select('id, username')
      .order('username')
      .then(({ data }) => setEveryone(data ?? []));
  }, [tab, everyone]);

  const list = tab === 'chat' ? members : everyone;
  const sorted = list
    ? [...list].sort(
        (a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.username.localeCompare(b.username)
      )
    : null;
  const onlineCount = sorted ? sorted.filter((p) => online.has(p.id)).length : 0;

  return (
    <div className="dialog-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="people-title">
        <div className="dialog-head">
          <h2 id="people-title">People</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close people list">
            <Icon name="close" />
          </button>
        </div>
        <div className="setting people-tabs">
          <Segmented
            label="Who to show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'chat', label: `In ${room.name.length > 14 ? 'this chat' : room.name}` },
              { value: 'everyone', label: 'Everyone' },
            ]}
          />
          {sorted && (
            <p className="hint">
              {onlineCount} online, {sorted.length} total
            </p>
          )}
        </div>
        {!sorted && <p className="empty">Loading…</p>}
        <ul className="plist">
          {(sorted ?? []).map((p) => {
            const isOnline = online.has(p.id);
            return (
              <li key={p.id} className="person">
                <span className="avwrap">
                  <Avatar name={p.username} size={38} />
                  <span className={isOnline ? 'pdot on' : 'pdot'} />
                </span>
                <div className="pname">
                  <strong>
                    {p.username}
                    {p.id === userId ? ' (you)' : ''}
                  </strong>
                  <span className="muted small">{isOnline ? 'Online' : 'Offline'}</span>
                </div>
                {canMention && p.id !== userId && (
                  <button className="outline small-btn" onClick={() => onMention(p.username)}>
                    Mention
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ---------- One message (only re-renders when it changes) ---------- */

const MessageRow = memo(function MessageRow({
  m,
  mine,
  first,
  last,
  flash,
  canPost,
  clock24,
  me,
  onReply,
  onJump,
  onMedia,
}) {
  return (
    <li
      id={`msg-${m.id}`}
      className={`row${mine ? ' mine' : ''}${first ? '' : ' tight'}${flash ? ' flash' : ''}${m.pending ? ' pending' : ''}`}
    >
      {!mine && (first ? <Avatar name={m.username} /> : <span className="spacer" />)}
      <div className="msg">
        {!mine && first && <span className="name">{m.username}</span>}
        {m.reply_to &&
          (m.reply ? (
            <button className="quote" onClick={() => onJump(m.reply.id)}>
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
                decoding="async"
                onLoad={onMedia}
              />
            </a>
          ))}
        {m.content && (
          <div className="bubble">
            <Rich text={m.content} me={me} />
          </div>
        )}
        {last && <time>{m.pending ? 'Sending…' : fmtTime(m.created_at, clock24)}</time>}
      </div>
      {canPost && !m.pending && (
        <button className="act" onClick={() => onReply(m)} aria-label={`Reply to ${m.username}`}>
          <Icon name="reply" size={18} />
        </button>
      )}
    </li>
  );
});

/* ---------- One open chat ---------- */

function Room({
  user,
  room,
  settings,
  username,
  muted,
  dot,
  isAdmin,
  bgImage,
  online,
  busRef,
  onToggleMute,
  onRead,
  onRefresh,
  onMenu,
  onSettings,
  onLeft,
}) {
  const [messages, setMessages] = useState(() => roomCache.get(room.id) ?? []);
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
  const [refreshing, setRefreshing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [hasMore, setHasMore] = useState(() => (roomCache.get(room.id)?.length ?? 0) >= PAGE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const names = useRef({});
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef([]);
  messagesRef.current = messages;
  const lastIdRef = useRef(null);
  const atBottomRef = useRef(true);
  const prevLen = useRef(0);
  const anchor = useRef(null);
  const prependRef = useRef(false);
  const tmpSeq = useRef(0);

  const announce = !!room.is_announcement;
  const canPost = !announce || isAdmin;
  const staticRoom = room.is_general || announce;
  const bg = bgStyle(settings, bgImage);
  const hasBg = Object.keys(bg).length > 0;

  const remaining = block ? Math.max(0, Math.ceil((block.until - Date.now()) / 1000)) : 0;
  const isBlocked = remaining > 0;

  const onlineHere = members.filter((m) => online.has(m.id)).length;
  const subtitle = announce
    ? 'News from the owner'
    : `${members.length} member${members.length === 1 ? '' : 's'}, ${onlineHere} online`;

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

  async function loadMessages(replace) {
    const { data, error } = await supabase
      .from('messages')
      .select(SELECT)
      .eq('room_id', room.id)
      .order('id', { ascending: false })
      .limit(PAGE);
    if (error) {
      setError(`Could not load messages: ${error.message}`);
      return;
    }
    const rows = data.map(toRow);
    rows.forEach((r) => (names.current[r.user_id] = r.username));
    const sorted = [...(await attachReplies(rows))].sort((a, b) => a.id - b.id);
    const current = messagesRef.current.filter((m) => !m.pending);
    const gap = current.length > 0 && sorted.length > 0 && current[current.length - 1].id < sorted[0].id;
    if (replace || gap) setMessages(sorted);
    else add(sorted);
    if (replace || gap || current.length === 0) setHasMore(rows.length === PAGE);
  }

  async function loadOlder() {
    const oldest = messagesRef.current.find((m) => !m.pending)?.id;
    if (oldest == null || loadingOlder) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const { data, error } = await supabase
      .from('messages')
      .select(SELECT)
      .eq('room_id', room.id)
      .lt('id', oldest)
      .order('id', { ascending: false })
      .limit(PAGE);
    if (error) {
      setError(`Could not load older messages: ${error.message}`);
      setLoadingOlder(false);
      return;
    }
    const rows = data.map(toRow);
    rows.forEach((r) => (names.current[r.user_id] = r.username));
    setHasMore(rows.length === PAGE);
    const withReplies = await attachReplies(rows);
    if (withReplies.length > 0) {
      anchor.current = el ? { h: el.scrollHeight, t: el.scrollTop } : null;
      prependRef.current = true;
      add(withReplies);
    }
    setLoadingOlder(false);
  }

  // Keep your place when older messages appear above.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (anchor.current && el) {
      el.scrollTop = anchor.current.t + (el.scrollHeight - anchor.current.h);
      anchor.current = null;
    }
  }, [messages]);

  useEffect(() => {
    roomCache.set(
      room.id,
      messages.filter((m) => !m.pending)
    );
  }, [messages, room.id]);

  // Live messages for this chat arrive through the one shared connection.
  useEffect(() => {
    let active = true;
    loadMessages(false);

    const handler = async (m) => {
      if (m.room_id !== room.id) return;
      let uname = names.current[m.user_id];
      if (!uname) {
        const { data } = await supabase.from('profiles').select('username').eq('id', m.user_id).single();
        uname = data?.username ?? 'unknown';
        names.current[m.user_id] = uname;
      }
      const [row] = await attachReplies([toRow({ ...m, username: uname })]);
      if (active) add([row]);
    };
    busRef.current.add(handler);

    return () => {
      active = false;
      busRef.current.delete(handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => {
    let active = true;
    supabase
      .from('room_members')
      .select('user_id, profiles(username)')
      .eq('room_id', room.id)
      .then(({ data }) => {
        if (active)
          setMembers((data ?? []).map((r) => ({ id: r.user_id, username: r.profiles?.username ?? 'unknown' })));
      });
    return () => {
      active = false;
    };
  }, [room.id, tick]);

  const scrollToEnd = useCallback((behavior = 'smooth') => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const onMedia = useCallback(() => {
    if (atBottomRef.current) scrollToEnd('auto');
  }, [scrollToEnd]);

  // Stay at the bottom for new messages, unless you scrolled up to read.
  useEffect(() => {
    const added = messages.length - prevLen.current;
    const wasEmpty = prevLen.current === 0;
    prevLen.current = messages.length;
    if (added <= 0) return;
    if (prependRef.current) {
      prependRef.current = false;
      return;
    }
    const lastMsg = messages[messages.length - 1];
    if (wasEmpty || atBottomRef.current || lastMsg?.user_id === user.id) {
      scrollToEnd(wasEmpty ? 'auto' : 'smooth');
    } else {
      setNewCount((c) => c + added);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  function onScroll(e) {
    const el = e.currentTarget;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    atBottomRef.current = near;
    setShowJump(!near);
    if (near) setNewCount(0);
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    await Promise.all([loadMessages(true), onRefresh()]);
    setTick((t) => t + 1);
    setRefreshing(false);
  }

  // Mark this chat as read while you can see it.
  const lastId = messages[messages.length - 1]?.id;
  lastIdRef.current = lastId;
  useEffect(() => {
    if (lastId != null && lastId < 1e15 && !document.hidden) onRead(room.id, lastId);
  }, [lastId, room.id, onRead]);
  useEffect(() => {
    const onVis = () => {
      const id = [...messagesRef.current].reverse().find((m) => !m.pending)?.id;
      if (!document.hidden && id != null) onRead(room.id, id);
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

  // The message appears instantly, then is confirmed by the server.
  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content || isBlocked) return;
    setText('');
    setError('');
    inputRef.current?.focus();
    const tmpId = 1e15 + ++tmpSeq.current;
    add([
      {
        id: tmpId,
        pending: true,
        room_id: room.id,
        content,
        created_at: new Date().toISOString(),
        user_id: user.id,
        username,
        reply_to: replyTo?.id ?? null,
        reply: replyTo
          ? { id: replyTo.id, username: replyTo.username, content: replyTo.content, kind: replyTo.attachment_kind }
          : null,
      },
    ]);
    const ok = await post({ content });
    setMessages((prev) => prev.filter((m) => m.id !== tmpId));
    if (!ok) setText(content);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && settings.enterSends && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  async function pickFile(e) {
    const original = e.target.files?.[0];
    e.target.value = '';
    if (!original) return;
    if (isBlocked) {
      setError('Wait a moment before sending again.');
      return;
    }
    if (original.size > MAX_BYTES) {
      setError('Files must be 10 MB or smaller.');
      return;
    }
    setError('');
    setUploading(true);
    const file = await shrinkImage(original);
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
      attachment_name: original.name,
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

  const jumpTo = useCallback((id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(id);
    setTimeout(() => setFlash(null), 1400);
  }, []);

  const onReply = useCallback((m) => {
    setReplyTo(m);
    inputRef.current?.focus();
  }, []);

  function mention(name) {
    setPeopleOpen(false);
    setText((t) => `${t && !t.endsWith(' ') ? `${t} ` : t}@${name} `);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const close = (a, b) =>
    a && b && a.user_id === b.user_id && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < 5 * 60 * 1000;

  return (
    <div className={`room-view${announce ? ' announcing' : ''}`}>
      <TopBar
        onMenu={onMenu}
        onSettings={onSettings}
        dot={dot}
        avatar={<RoomAvatar room={room} size={36} />}
        title={room.name}
        subtitle={subtitle}
        onSubtitle={announce ? undefined : () => setPeopleOpen(true)}
      >
        <button
          className={refreshing ? 'iconbtn spin' : 'iconbtn'}
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh chat"
        >
          <Icon name="refresh" />
        </button>
        <button
          className="iconbtn"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          aria-label="More options"
        >
          <Icon name="more" />
        </button>
      </TopBar>

      {moreOpen && (
        <>
          <button className="popover-scrim" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="popover" role="menu">
            <button
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                setPeopleOpen(true);
              }}
            >
              <Icon name="users" size={18} />
              People
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                onToggleMute();
              }}
            >
              <Icon name={muted ? 'bellOff' : 'bell'} size={18} />
              {muted ? 'Unmute chat' : 'Mute chat'}
            </button>
            {!staticRoom && (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    addPerson();
                  }}
                >
                  <Icon name="userPlus" size={18} />
                  Add person
                </button>
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMoreOpen(false);
                    leave();
                  }}
                >
                  <Icon name="logout" size={18} />
                  Leave group
                </button>
              </>
            )}
          </div>
        </>
      )}

      <div className={`msgwrap${hasBg ? ' has-bg' : ''}`} style={bg}>
        <ol className="messages" ref={listRef} onScroll={onScroll}>
          {hasMore && (
            <li className="older">
              <button className="outline small-btn" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? 'Loading…' : 'Load earlier messages'}
              </button>
            </li>
          )}
          {messages.length === 0 && !error && (
            <li className="empty">{announce ? 'No announcements yet.' : 'No messages yet. Say hello below.'}</li>
          )}
          {messages.map((m, i) => (
            <MessageRow
              key={m.id}
              m={m}
              mine={m.user_id === user.id && !announce}
              first={!close(messages[i - 1], m)}
              last={!close(m, messages[i + 1])}
              flash={flash === m.id}
              canPost={canPost}
              clock24={settings.clock24}
              me={username}
              onReply={onReply}
              onJump={jumpTo}
              onMedia={onMedia}
            />
          ))}
        </ol>

        {showJump && (
          <button
            className="jump"
            onClick={() => scrollToEnd('smooth')}
            aria-label={newCount ? `${newCount} new messages, scroll to the latest` : 'Scroll to the latest messages'}
          >
            <Icon name="arrowDown" size={18} />
            {newCount > 0 && <span>{newCount} new</span>}
          </button>
        )}
      </div>

      {error && <p className="error bar" role="alert">{error}</p>}
      {block?.kind === 'mute' && isBlocked && (
        <p className="notice bar" role="status">
          You are muted for {remaining}s.
        </p>
      )}
      {uploading && <p className="notice bar">Uploading…</p>}

      {canPost ? (
        <>
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
              placeholder={announce ? 'Write an announcement' : 'Message'}
              maxLength={2000}
              aria-label="Message"
              enterKeyHint={settings.enterSends ? 'send' : 'enter'}
            />
            <button className="send" disabled={!text.trim() || isBlocked} aria-label="Send message">
              <Icon name="send" size={20} />
            </button>
          </form>
        </>
      ) : (
        <p className="readonly">Announcements are read-only. Only the owner can post here.</p>
      )}

      {peopleOpen && (
        <PeopleDialog
          room={room}
          userId={user.id}
          members={members}
          online={online}
          canMention={canPost}
          onMention={mention}
          onClose={() => setPeopleOpen(false)}
        />
      )}
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
            <img src={g.preview} alt={g.title || 'GIF'} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      <p className="muted small">Powered by GIPHY</p>
    </div>
  );
}
