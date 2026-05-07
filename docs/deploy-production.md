# SerginhoBet Production Deploy

This setup is free-tier friendly and does not require Docker.

## 1. Supabase

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Go to Authentication > Providers > Twitch and enable it.
4. Copy the Supabase Twitch callback URL shown in the provider screen.

## 2. Twitch Developer Console

1. Create an app in the Twitch Developer Console.
2. Add the Supabase callback URL as an OAuth Redirect URL.
3. Copy the Twitch Client ID and Client Secret back into the Supabase Twitch provider.
4. Save the provider.

Only Twitch login is supported by the app. Do not enable email/password login for production.

## 3. Make SerginhoEsteves the streamer

After SerginhoEsteves logs in once, run this in Supabase SQL Editor:

```sql
update public.profiles
set role = 'streamer'
where lower(display_name) = 'serginhoesteves';
```

Mods can also manage final slips:

```sql
update public.profiles
set role = 'mod'
where lower(display_name) in ('chicão', 'gaxolas');
```

## 4. Vercel

1. Import this repo into Vercel.
2. Framework preset: Vite.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Add environment variables:

```txt
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_SITE_URL=https://YOUR_VERCEL_DOMAIN
```

Redeploy after adding variables.

## 5. GitHub Action for daily matches

Add these repository secrets in GitHub:

```txt
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
API_FOOTBALL_KEY=YOUR_API_FOOTBALL_KEY
```

The workflow `.github/workflows/import-matches.yml` runs every day at 05:30 UTC and can also be triggered manually.

Never expose `SUPABASE_SERVICE_ROLE_KEY` or `API_FOOTBALL_KEY` as `VITE_*` variables.

## 6. Local production test

Create `.env.local` from `.env.example` and run:

```bash
npm run import:matches
npm run build
npm run preview
```

Login should redirect through Twitch. The app should only load data after authentication.
