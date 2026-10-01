# GabAI EDU — Android client

Teacher app for this backend: scan and grade paper assessments, draft lessons
with Gemini, and keep class records. A React + TypeScript + Tailwind app (`web/`)
runs inside a native Android WebView shell (`app/`).

It follows [docs/frontend-integration.md](../docs/frontend-integration.md):

- **Login** is Supabase email/password plus TOTP MFA; FastAPI only ever sees the
  `aal2` access token.
- **Grading is offline-first.** Answer keys, recognition review, scoring and
  approval all happen on the phone. Results upload later through the idempotent
  `/v1/uploads/*` routes, retried with the exact same payload.
- **Scoring** is a TypeScript port of scoring-v1 (`web/src/lib/scoring.ts`),
  tested against [fixtures/scoring-v1.json](../fixtures/scoring-v1.json). The
  Review screen can cross-check a score with `/v1/scoring/preview`.
- **Online OCR** (`/v1/ocr/student`, `/v1/ocr/reference`) and **teaching
  materials** (`/v1/materials/*`) run only when the teacher taps for them.
- **The AI Assistant covers Elementary (K–6), High School (7–12) and College
  (1st–4th year).** Subjects follow the grade band, and the flow takes the level's
  colour (yellow, green, blue); see `web/src/lib/levels.ts`.

Without a server configured the app still runs a fully offline **demo
workspace** (Teacher Elena, sample classes, simulated recognition and template
lesson drafts). Nothing in demo mode leaves the device.

## Run it

Open this `mobile/` folder in Android Studio and Run. The built web bundle is
committed in `app/src/main/assets/www`, so Node is only needed to change the UI.

### Connect to a backend

Add to `mobile/local.properties` (git-ignored), then rebuild:

```properties
gabai.apiBaseUrl=https://your-service.run.app
gabai.supabaseUrl=https://YOUR-PROJECT.supabase.co
gabai.supabasePublishableKey=your-publishable-key
```

The same values can come from `GABAI_API_BASE_URL`, `GABAI_SUPABASE_URL` and
`GABAI_SUPABASE_PUBLISHABLE_KEY`. The publishable key is public by design.

On the backend, allow the WebView origin, and the dev server's origin if you use it:

```bash
CORS_ORIGINS='["https://appassets.androidplatform.net","http://localhost:5179"]'
```

For a backend on your own machine, use `http://10.0.2.2:8000` from the emulator
or your computer's LAN address from a phone. Debug builds allow plain HTTP to
`10.0.2.2`, `localhost` and `127.0.0.1` only; release builds require HTTPS.

### Change the web app

```bash
cd mobile/web
npm install
npm test          # scoring-v1 fixtures + guards
npm run dev       # browser dev loop; copy .env.example to .env.local first
npm run build     # typecheck, then rebuild app/src/main/assets/www
```

Commit the rebuilt `assets/www` with your source change so the APK matches the source.

## How the pieces map to the API

| App | Backend |
|---|---|
| Sign in, create account, two-step setup | Supabase Auth (`signInWithPassword`, `signUp`, `mfa.enroll` / `challengeAndVerify`), then `GET /v1/me` |
| New assessment & answer key (MCQ A–D, True/False) | queued `POST /v1/uploads/assessments` with `key_teacher_verified: true` after the teacher ticks "I checked every answer" |
| Fill key from a photo | `POST /v1/ocr/reference` (draft only; every answer still needs the teacher) |
| Read answers online | `POST /v1/ocr/student` → answer states (`recognized`, `ambiguous`, `unreadable`, `blank_candidate`) |
| Touch-ups, "confirm recognized" | local `confirmed` / `confirmed_blank`; recognition alone never confirms |
| Points per question → adjust | local adjustments (absolute score + reason), never on unresolved answers |
| Check score with the server | `POST /v1/scoring/preview` with `client_score` |
| Approve | local approval, then queued `POST /v1/uploads/submissions` with `client_score` and `local_approved_at` |
| Sync | uploads (assessments before their results), then `GET /v1/assessments`, `/v1/submissions?status=approved`, `/v1/materials` |
| AI Assistant generate / save / mark reviewed | `POST /v1/materials/generate`, `PATCH /v1/materials/{id}`, `POST /v1/materials/{id}/review` |
| Refine (review questions, simplify, bilingual) | `POST /v1/materials/generate` with `kind: rewrite` (a separate, billed draft) |

Rejected uploads are never retried automatically. A `409 upload_conflict` keeps
the local copy and offers "Upload as new" (new UUID) or "Stop uploading" in Records.

## Known gaps

- **No confidence percentages in connected mode.** The backend deliberately
  returns answer states and review flags instead; the demo's 98.4% figure is gone too.
- **Answer keys are created on the device.** Editing a verified key (a new key
  version) and essay questions are not in the UI yet.
- **Classes are plain labels**, stored in the assessment's `category`. The
  backend's academic years, sections, students and enrollments, plus
  performance reports and consultations, are not wired up yet.
- **Student feedback stays on the device.** The backend has no field for it.
- **Session storage.** The Supabase session and offline workspace live in the
  WebView's app-private storage, not Android Keystore-backed encrypted storage.
- **No live Gemini or Supabase verification.** Integration was tested against
  the real backend code with a stand-in Auth server and a stand-in Gemini
  adapter, not a live project.

## Layout

```
mobile/
├── app/                         Android shell (Kotlin, AGP 9, compileSdk 36, minSdk 26)
│   └── src/
│       ├── main/java/com/example/gabai/
│       │   ├── MainActivity.kt  WebView host: asset loader, camera permission, photo
│       │   │                    picker, back gesture, edge-to-edge insets
│       │   └── NativeBridge.kt  window.GabAINative: runtime config, share files,
│       │                        print to PDF, status-bar theme
│       ├── main/assets/www/     built web app (npm run build)
│       └── debug/res/xml/       dev-only cleartext allowance
└── web/src/
    ├── lib/scoring.ts           scoring-v1 port (+ scoring.test.ts on the shared fixtures)
    ├── lib/api.ts, auth.ts      typed /v1 client, Supabase auth + MFA
    ├── lib/sync.ts, store.ts    upload outbox, download merge, per-account workspaces
    ├── lib/materials.ts         AI Assistant ↔ teaching materials
    └── screens/                 Login, Hub, KeyEditor, Scan (4 steps), AI (3 steps), Records
```
