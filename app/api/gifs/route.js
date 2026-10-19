import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) {
    return Response.json({ error: 'GIF search is not set up yet.' }, { status: 503 });
  }

  // Only signed-in users may use the GIF search (keeps your key from being abused).
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Log in to search GIFs.' }, { status: 401 });
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth?.user) {
    return Response.json({ error: 'Log in to search GIFs.' }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get('q')?.trim();
  const params = new URLSearchParams({ api_key: key, limit: '24', rating: 'pg-13' });
  if (q) params.set('q', q);

  const res = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params}`);
  if (!res.ok) return Response.json({ error: 'GIF search failed. Try again later.' }, { status: 502 });

  const json = await res.json();
  const gifs = (json.data ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    preview: g.images.fixed_height_small.url,
    url: g.images.fixed_height.url,
  }));
  return Response.json({ gifs });
}
