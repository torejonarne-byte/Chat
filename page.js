'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const SELECT = 'id, content, created_at, user_id, profiles(username)';

const toRow = (m) => ({
  id: m.id,
  content: m.content,
  created_at: m.created_at,
  user_id: m.user_id,
  username: m.username ?? m.profiles?.username ?? 'unknown',
});

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
  return session ? <Chat user={session.user} /> : <AuthForm />;
}

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
            : 'Welcome back. Your messages are right where you left them.'}
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

function Chat({ user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const names = useRef({});
  const endRef = useRef(null);
  const me = user.user_metadata?.username || user.email;

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
        .order('created_at', { ascending: false })
        .limit(100);
      if (!active) return;
      if (error) {
        setError('Could not load messages. Refresh the page to try again.');
        return;
      }
      const rows = data.map(toRow);
      rows.forEach((r) => (names.current[r.user_id] = r.username));
      add(rows);
    }
    load();

    const channel = supabase
      .channel('room-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
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
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setText('');
    setError('');
    const { data, error } = await supabase
      .from('messages')
      .insert({ content })
      .select(SELECT)
      .single();
    if (error) {
      setText(content);
      setError('Message not sent. Check your connection and try again.');
      return;
    }
    add([toRow(data)]);
  }

  return (
    <div className="chat">
      <header>
        <div>
          <strong>Chatroom</strong>
          <span className="muted"> · signed in as {me}</span>
        </div>
        <button className="link" onClick={() => supabase.auth.signOut()}>
          Log out
        </button>
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
              <div className="bubble">{m.content}</div>
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

      <form className="composer" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message"
          maxLength={2000}
          aria-label="Message"
          autoFocus
        />
        <button className="primary" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
