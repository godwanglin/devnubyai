# 04 — Roadmap Implementasi Phase per Phase

> Status: **DRAFT — menunggu review**. Kerjakan **satu phase per sesi**; phase berikutnya baru dimulai setelah "Definition of Done" phase sebelumnya terpenuhi dan di-commit.
> Referensi: `01-database-schema.md`, `02-api-routing.md`, `03-smart-routing.md`, `ARCHITECTURE_RULES.md`.

## Phase 0 — Persiapan (kecil)
- Review & setujui 4 dokumen plan ini (keputusan terbuka di `01` §6).
- Commit pekerjaan tools + R2 yang sudah ada.
- Tentukan library auth (Auth.js vs custom OAuth Google) → memengaruhi tabel `auth_*`.

**DoD:** plan disetujui, working tree bersih.

## Phase 1 — Database & migration
- Install Prisma (provider `mysql`, driver adapter MariaDB), `prisma.config.ts`, client singleton `src/lib/db/`.
- Tulis `schema.prisma` sesuai `01-database-schema.md`; kolom generated `primary_marker` + CHECK via migration SQL manual (`--create-only`).
- Seed: `plans`, `model_providers` (+ SVG logo di `public/brand-logos/`), `app_settings` `routing.*`, migrasi gateway dari `.env` → `gateways` (API key terenkripsi AES-GCM pakai `GATEWAY_SECRET_KEY`).
- Verifikasi: `EXPLAIN` query Q1–Q13 memakai index yang direncanakan; uji UNIQUE single-primary menolak primary kedua.

**DoD:** `prisma migrate deploy` sukses di DB VPS, seed jalan, `.env` tidak lagi berisi `GATEWAY_UPSTREAM`/`GATEWAY_API_KEY`.

## Phase 2 — Auth & fondasi API
- Login Google → `users`, `auth_accounts`, `auth_sessions` (cookie HttpOnly).
- `src/proxy.ts`: request-id, cek Origin, gate `/api/v1/admin/**`.
- `src/lib/api/`: helper response/error seragam, zod, mapping error publik.
- `GET /api/v1/me`, `GET /api/v1/models` (dari DB, menggantikan `src/data/models.json`).

**DoD:** user bisa login, composer membaca model dari DB, admin route menolak non-admin.

## Phase 3 — Gateway client & smart router (tanpa UI)
- `src/lib/gateways/`: repository, crypto, adapter `chat` & `responses` (stream → event internal).
- `src/lib/routing/`: `resolveCandidates`, `executeWithFallback`, klasifikasi error, circuit breaker, cache berbasis `routing.version`, log `routing_attempts`.
- Semua parameter dari `app_settings` — **tidak ada konstanta routing di kode**.
- Test integrasi: gateway palsu lokal (mock server) yang mengembalikan 500/429/404/timeout untuk membuktikan fallback A → B → C dan circuit breaker.

**DoD:** script test membuktikan fallback & circuit sesuai setting DB; mengubah primary di DB langsung mengubah urutan.

## Phase 4 — Chat API SSE + persistensi
- `POST /api/v1/chats/{id}/messages` → SSE (`meta`/`delta`/`reasoning`/`tool`/`ping`/`done`/`error`), tutup setelah selesai.
- CRUD chats & history (cursor), stop/regenerate, abort saat client disconnect.
- Integrasi tools loop (`src/lib/tools`) + `session_files` metadata.
- Kuota & rate limit (`user_usage_periods`, `plans`).
- Frontend: ganti data dummy `sessions.json` dengan API; reader stream `fetch` di composer.

**DoD:** chat end-to-end dari UI ke gateway primary, fallback tidak terlihat user, history tersimpan, tidak ada info gateway di DevTools.

## Phase 5 — Admin `/admin/model-catalog`
- Tab Gateways (CRUD, primary, test, sync, reset circuit).
- Tab Katalog Upstream (sync `/v1/models`, filter, status available).
- Tab Katalog Chat (CRUD model publik, logo picker, panel routing drag-and-drop, dry run).
- Tab Routing Settings & Logs.
- Setiap mutation → `admin_audit_logs` + bump `routing.version`.
- UI memakai primitive `@/components/ui/`, i18n `id.json`/`en.json`, file ≤ 500 baris.

**DoD:** admin bisa membuat `openai/gpt-6-luna` dengan 3 kandidat lintas gateway sepenuhnya dari panel, dan chat langsung memakainya.

## Phase 6 — Hardening & observability
- Job terjadwal: auto-sync model upstream, purge `routing_attempts` (`logs.routing_retention_days`), cleanup `auth_sessions` kedaluwarsa, tandai pesan `streaming` macet.
- Dashboard error rate / latency / TTFT per gateway.
- Security review menyeluruh (OWASP, IDOR, rate limit, header keamanan).
- Load test streaming ringan & tuning pool koneksi DB.

**DoD:** review keamanan bersih, job berjalan, dashboard menampilkan data nyata.

## Urutan dependensi

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
                              (Phase 5 UI bisa mulai paralel setelah Phase 3 selesai,
                               karena hanya butuh repository + API admin)
```
