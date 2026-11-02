# The Greywater Light: online treasure hunt

9 chained puzzles, participant + organiser logins, live leaderboard.
Static front-end + one serverless API (Vercel) + Supabase (Postgres).

## File layout

```
greywater-light/
├── public/
│   └── index.html        ← the whole front-end (HTML + CSS + JS in one file)
├── api/
│   ├── game.js           ← the entire backend (login, answers, scoring, admin)
│   ├── _levels.js        ← ALL puzzles, hints and ANSWERS (server only)
│   └── _assets/          ← puzzle images (served only to players who reach that level)
│       ├── lab1.png
│       └── lab2.png
├── supabase.sql          ← run once in Supabase to create the tables
├── package.json
├── vercel.json
├── dev.js                ← optional local test server
└── .gitignore
```

Nothing secret is in `public/`. The organiser login, answers and signing key live only on the server
(environment variables + `api/`). **Keep the GitHub repo private**, because `api/_levels.js` contains the answers.

## 1. Supabase (database)

1. https://supabase.com → **New project** (any name, pick a region, save the DB password).
2. Left menu → **SQL Editor → New query** → paste all of `supabase.sql` → **Run**.
3. **Project Settings → API** (or **Data API / API Keys**) and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret key → `SUPABASE_SERVICE_ROLE_KEY`
   (Not the anon/publishable key. The service_role key bypasses row-level security and must only ever be used on the server.)

## 2. GitHub

```bash
cd greywater-light
git init
git add .
git commit -m "Treasure hunt"
git branch -M main
# create an EMPTY PRIVATE repo on github.com first, then:
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

## 3. Vercel

1. https://vercel.com → **Add New → Project → Import** your GitHub repo.
2. Framework Preset: **Other**. Leave Build/Output settings empty. Do not override anything.
3. Open **Environment Variables** and add these five (all environments):

| Name | Value |
|---|---|
| `ADMIN_USER` | organiser username |
| `ADMIN_PASS` | organiser password |
| `SESSION_SECRET` | any long random string (e.g. run `openssl rand -hex 32`) |
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |

4. **Deploy**. If you change an environment variable later, redeploy (Deployments → ⋯ → Redeploy).

Every `git push` to `main` redeploys automatically.

## 4. Event-day checklist

- Open the site → **Organiser sign in** (link under the login form) → check the answer key and test the hunt with your own player account.
- In the control room use **Reset** on your test account before the event, and **Close the hunt** until you are ready to start. Press **Open the hunt** at kick-off.
- Show `/#/board` on a projector; it needs no login.
- **Announcement** posts a banner to every player. **Delete** removes a player. **Reset** sends one back to level 1.

## Scoring

Rank = levels solved (more is better), then time from pressing "Start the hunt" to the last level solved
plus a penalty per hint (3 minutes, set `HINT_PENALTY_MIN` in `api/_levels.js`). Guesses are limited to one every 1.5 seconds per player.

## Changing or adding puzzles

Edit `api/_levels.js`. Each level has `title`, `story`, `blocks`, `hints` and `answers`. Block kinds are listed at the top of that file.
Add a new level by adding an object to the array; the tower and leaderboard adapt automatically.
If you change the number of levels after players have started, reset them.
Images for the "image lab" go in `api/_assets/` (grayscale for the levels puzzle; for the bit-plane puzzle hide text in the LSB of one channel).

## Running locally (optional)

```bash
npm install
ADMIN_USER=you ADMIN_PASS=something SESSION_SECRET=abc node dev.js
# open http://localhost:3000
```
Without the Supabase variables it uses a temporary in-memory store (cleared on restart), which is fine for testing.

## Security notes

- Players sign in with a name only (no password): whoever types an existing name continues that player's run. Login tokens are HMAC-signed and expire (players 14 days, organiser 12 hours).
- Organiser credentials are compared on the server only. Failed logins are rate-limited.
- Supabase tables have row-level security enabled with no policies, so the public key cannot read them.
- Players can still use browser dev tools (one level expects it). They can never see answers, since checking happens on the server.
- Use a strong `ADMIN_PASS` for a real event, because the organiser can see all answers.
