# Sibimate

A voice-first marketplace for everyday tasks. A customer describes a task in Hindi or English, AI rewrites it as clear task details, and nearby helpers accept the customer's price or quote their own.

The system design is in [docs/architecture/sibimate-architecture.md](docs/architecture/sibimate-architecture.md), the decisions on its open questions are in [docs/decisions.md](docs/decisions.md), and the screen designs are in [design/canvas](design/canvas).

## Layout

| Path | Holds |
| --- | --- |
| `apps/api` | NestJS API: OTP sign-in, sessions, profile, task understanding, tasks |
| `apps/admin` | React and Vite dashboard: admin sign-in, bookings with assign, helpers |
| `apps/mobile` | Expo app: OTP sign-in, describe a task, confirm and post it, follow or cancel it |
| `packages/api-client` | Typed client for the API, with token refresh |
| `packages/shared` | Request and response schemas (zod), the task state machine, error codes |
| `packages/ui-tokens` | The [design system](https://claude.ai/artifact/PxZhHugugLqpZvHXyTSz3x)'s tokens as TypeScript |
| `infra` | Docker Compose for local PostgreSQL with PostGIS, and Redis |
| `docs`, `design` | Architecture and the design canvas source |

The API also runs as a worker process (`apps/api/src/worker.ts`) that takes matching jobs from Redis.

## Run it locally

Needs Node 24, pnpm and Docker.

```bash
pnpm install
pnpm db:up                                # PostgreSQL and Redis
cp apps/api/.env.example apps/api/.env    # then fill in the two secrets
pnpm db:migrate
pnpm dev                                  # API on http://localhost:3000/v1
```

In development the one-time code is printed in the API log instead of being sent by SMS.

To run a task end to end on your own machine, create a dashboard admin and a helper, then start the dashboard:

```bash
pnpm --filter @sibimate/api db:seed       # development only; the sign-in details are in apps/api/src/cli/seed-dev.ts
pnpm --filter @sibimate/admin dev         # dashboard on http://localhost:5173
```

Post a task in the app, assign it to the seeded helper in the dashboard, then sign in to the app with the helper's number and switch to Earn. For a real admin, run `pnpm --filter @sibimate/api admin:create you@example.com owner` and add the address it prints to an authenticator app.

To run the app, keep the API running and start Expo in a second terminal:

```bash
pnpm --filter @sibimate/mobile web        # in the browser, the quickest way to try it
pnpm --filter @sibimate/mobile android    # needs Android Studio and an emulator, or a phone
```

On an emulator or a phone, copy `apps/mobile/.env.example` to `apps/mobile/.env` and point `EXPO_PUBLIC_API_URL` at your computer.

## Checks

```bash
pnpm build && pnpm lint && pnpm typecheck
pnpm test        # unit tests
pnpm test:e2e    # API tests against the local sibimate_test database
```

After changing `apps/api/src/db/schema.ts`, run `pnpm --filter @sibimate/api db:generate` and commit the new migration.

## API so far

All routes are under `/v1`. Errors are `{ code, message, details }` with a stable `code` from `packages/shared`.

| Route | Does |
| --- | --- |
| `POST /auth/otp/request` | Sends a 6-digit code to an Indian mobile number |
| `POST /auth/otp/verify` | Checks the code, creates the account on first sign-in, returns tokens and the user |
| `POST /auth/refresh` | Swaps a refresh token for a new pair |
| `POST /auth/logout` | Signs the device out |
| `GET /me`, `PATCH /me` | Reads and updates name and language |
| `POST /tasks/interpret` | Turns typed text (JSON) or a voice recording (multipart `audio`) into task details, to accept or reject |
| `POST /tasks` | Posts a task; needs an `Idempotency-Key` header |
| `GET /tasks`, `GET /tasks/:id` | The customer's tasks, newest first, a page at a time |
| `POST /tasks/:id/cancel` | Cancels a task before the work starts |
| `PUT /helper/availability`, `PUT /helper/location` | A helper goes online or offline, and the app reports where they are |
| `GET /helper/tasks/nearby` | The tasks a helper has been shown, without the address |
| `POST /helper/tasks/:id/accept`, `/quote`, `/decline` | Take a task at the customer's price, name a price, or pass |
| `GET /tasks/:id/offers`, `POST /tasks/:id/offers/:offerId/accept` | The customer sees helpers' offers and picks one |
| `POST /tasks/:id/retry` | Posts an expired task again, optionally at a higher price |
| `GET /helper/profile`, `POST /helper/profile`, `POST /helper/documents` | Apply to be a helper and upload document photos |
| `POST /bookings/:id/review` | The customer and the helper rate each other once the job is paid |
| `GET /admin/applications`, `POST /admin/applications/:id/approve`, `/reject` | A verifier reviews an application |
| `GET /admin/documents/:id/file` | A document's image, for owners and verifiers; every view is recorded |
| `GET /helper/bookings`, `GET /helper/bookings/:id` | A helper's jobs |
| `POST /bookings/:id/en-route`, `/start`, `/complete` | The helper sets off, then starts and finishes with the customer's 4-digit codes |
| `POST /bookings/:id/payment/cash-received`, `/cancel` | The helper confirms cash, or gives the job up |
| `POST /admin/auth/login`, `/admin/auth/logout`, `GET /admin/me` | Dashboard sign-in with email, password and authenticator code |
| `GET /admin/tasks`, `POST /admin/tasks/:id/assign` | Tasks for the dashboard, and assigning a helper by hand |
| `GET /admin/helpers`, `POST /admin/helpers` | Helpers, and making a phone number a helper |
| `GET /health` | Checks the API and the database |

## Decisions made while building

- **Drizzle** for the database, because PostGIS columns and hand-checked SQL migrations are simple with it.
- **`@nestjs/authentication`** issues the 15-minute access token and the rotating refresh token. A spent refresh token that comes back signs that device out.
- **One-time codes** are stored as a keyed hash, work once, on the device that asked, for 5 minutes, with 5 guesses. A number can ask again after 30 seconds, up to 5 codes an hour.
- **Task understanding** sits behind `TaskInterpreter` in `apps/api/src/interpretation`, and voice behind `SpeechToText`. `TASK_INTERPRETER=openai` with an `OPENAI_API_KEY` uses OpenAI for both: a model writes the details, and recordings are transcribed and never stored. `TASK_INTERPRETER=rules` is a keyword stand-in for development with no voice, refused in production. `none` sends customers to the typed form.
- **Platform rules** (cancellation fee, cash dues limit, dispute window, completion-code wait) live in `platform_settings` and are edited on the dashboard's Settings page by the owner or finance role.
- **Matching** searches in rings of 2, 5 and 8 km (`MATCHING_RINGS` in `packages/shared`), notifying up to ten helpers per ring, nearest and most reliable first. Unskilled tasks go to the first helper who accepts; for skilled tasks and for quotes the customer chooses. With `MATCHING_QUEUE=redis` each ring is a delayed BullMQ job run by the worker (`pnpm --filter @sibimate/api dev:worker`); `inline` runs rings on timers inside the API for development and is refused in production.
- **Live updates** go over one socket.io connection per signed-in client. A client only ever receives events addressed to it, and each event just says that something changed; the screens then fetch fresh data through the API. Screens also refresh every 30 seconds in case the connection drops. With `MATCHING_QUEUE=redis`, events travel over Redis so the worker's reach the API's sockets.
- **The tracking map** is a Leaflet page with OpenStreetMap tiles, shown in a web view on phones and an iframe in the browser. The helper's position is shared with the customer only between setting off and starting the job. OpenStreetMap's public tile servers are for light use: choose a tile provider before launch.
- **Admins** are separate from app users, with their own sessions: an app token never works on `/admin` routes, and an admin's never works in the app. Passwords are hashed with scrypt, authenticator secrets are encrypted with `TOTP_KEY`, a code works once, and five failures lock the account for 15 minutes.
- **Start and completion codes** are derived from a server secret and the booking id, so none is stored and the customer sees the same code each time. Five wrong codes lock entry for 10 minutes.
- **Helpers** apply in the app and upload photos of their documents; a verifier approves them at a level in the dashboard. An ID is needed for Basic, a face photo as well for Verified, and proof of a trade for Specialised, which is what gives the skilled tag. An admin can still add a helper by hand.
- **Documents** are kept on a private disk through `@nestjs/storage` (`STORAGE_ROOT`, a local folder for now; private object storage once hosting is chosen). They are served only through the API to owners and verifiers, and each view is written to `audit_log` with every other admin action.
- **Ratings** run from 1 to 5, once per side per job. A helper's average shows on their offers and in the dashboard. The database refuses a second helper on a task and a second job for a busy helper.
- **Exact addresses** are encrypted with `ADDRESS_KEY` before they are stored, and locations are PostGIS points.
- **`packages/api-client`** is written by hand against the shared schemas for now. Generating it from an OpenAPI document, as the architecture plans, waits until the API publishes one.
- **App copy** lives in `apps/mobile/src/locales` in English and Hindi. The Hindi needs a native speaker's review before launch.
- **`imresamu/postgis`** is the database image, because the official `postgis/postgis` image has no arm64 build for Apple Silicon.
