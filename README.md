# Chat app (Next.js + Supabase)

## Run locally
1. Install Node.js (v18+).
2. In this folder: `npm install` then `npm run dev`
3. Open http://localhost:3000

Your Supabase URL and publishable key are already in `.env.local`.

## Deploy (Vercel)
1. Push this folder to a GitHub repo (`.env.local` is git-ignored on purpose).
2. On vercel.com: Add New > Project > import the repo.
3. Under Environment Variables, add:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
4. Click Deploy.

Netlify works the same way: import the repo and add the same two variables.
