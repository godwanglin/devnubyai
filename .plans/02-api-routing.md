# 02 — API Routing & Transport Chat (Draft)

> Status: **Disetujui — sebagian terimplementasi**. Fondasi (`proxy.ts`, format response, auth, `/me`, `/models`, `/auth/*`, `GET /admin/gateways`) selesai di Phase 2 (`0350ccc`); endpoint chat/SSE menyusul di Phase 4, admin penuh di Phase 5.
> Next.js 16 App Router: semua endpoint = Route Handler `src/app/api/v1/**/route.ts` (lihat `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`). Proteksi cross-cutting di `src/proxy.ts` (konvensi pengganti `middleware`).

## 1. Prinsip

1. **Versioned**: semua API publik di bawah `/api/v1`. Breaking change → `/api/v2`, v1 tetap hidup selama masa deprecate.
2. **Tipis di route, tebal di service**: `route.ts` hanya parse + auth + validasi (zod) → panggil service di `src/lib/**`. Tidak ada logika routing gateway di route handler.
3. **Client hanya melihat ID publik**: `catalog_models.public_id`, `chat_sessions.public_id`, `chat_messages.public_id`. Gateway, upstream model, base URL, API key **tidak pernah** keluar dari server.
4. **Format response seragam**
   - Sukses: `{ "data": ..., "meta"?: { "nextCursor": "..." } }`
   - Error: `{ "error": { "code": "RATE_LIMITED", "message": "...", "requestId": "0192f3a4-7c1e-7b2a-9d4e-3f6a8b1c2d3e" } }`
   - Header `x-request-id` di setiap response (UUIDv7, sama dengan `routing_attempts.request_id`).
5. **Pagination cursor-based** (`?cursor=&limit=`), bukan offset.

## 2. Peta endpoint

### Publik (user login)

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/api/v1/me` | profil + plan + sisa kuota |
| `GET` | `/api/v1/models` | katalog publik aktif (`id`, nama, provider + logo, kategori, badge, capability). **Tanpa** info gateway |
| `GET` | `/api/v1/chats` | list sesi (sidebar), cursor |
| `POST` | `/api/v1/chats` | buat sesi baru |
| `GET` | `/api/v1/chats/{chatId}` | detail sesi |
| `PATCH` | `/api/v1/chats/{chatId}` | rename / pin |
| `DELETE` | `/api/v1/chats/{chatId}` | hapus sesi (+ file R2) |
| `GET` | `/api/v1/chats/{chatId}/messages` | history, cursor |
| `POST` | `/api/v1/chats/{chatId}/messages` | **kirim pesan → response SSE stream** |
| `POST` | `/api/v1/chats/{chatId}/messages/{messageId}/stop` | hentikan generate yang sedang berjalan |
| `POST` | `/api/v1/chats/{chatId}/messages/{messageId}/regenerate` | regenerate (SSE) |
| `POST` | `/api/v1/chats/{chatId}/files` | upload lampiran (multipart) |
| `GET` | `/api/v1/chats/{chatId}/files/{fileId}` | download via signed URL pendek / proxy |

### Auth

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/api/v1/auth/google` | mulai OAuth Google |
| `GET` | `/api/v1/auth/google/callback` | callback → set cookie sesi |
| `POST` | `/api/v1/auth/logout` | hapus sesi |

### Admin (`role = 'admin'`, dicek di proxy **dan** di service)

| Method | Path | Fungsi |
|---|---|---|
| `GET` / `POST` | `/api/v1/admin/gateways` | list / tambah gateway |
| `GET` / `PATCH` / `DELETE` | `/api/v1/admin/gateways/{id}` | detail / ubah / hapus (API key write-only, respons hanya `last4`) |
| `POST` | `/api/v1/admin/gateways/{id}/primary` | jadikan primary (transaksi atomik) |
| `POST` | `/api/v1/admin/gateways/{id}/test` | ping `/models` + test completion kecil |
| `POST` | `/api/v1/admin/gateways/{id}/sync-models` | sync `GET {base_url}{models_path}` → `upstream_models` |
| `GET` | `/api/v1/admin/upstream-models?gateway=&q=&available=` | tab "Katalog Upstream" |
| `GET` / `POST` | `/api/v1/admin/catalog-models` | tab "Katalog Chat" |
| `GET` / `PATCH` / `DELETE` | `/api/v1/admin/catalog-models/{id}` | ubah nama/logo/status/urutan |
| `PUT` | `/api/v1/admin/catalog-models/{id}/routes` | **ganti seluruh daftar kandidat berurutan** (satu transaksi) |
| `POST` | `/api/v1/admin/catalog-models/{id}/routes/dry-run` | simulasi: tampilkan urutan percobaan final (setelah aturan primary-first & circuit) |
| `GET` / `POST` | `/api/v1/admin/providers` | daftar / tambah provider logo |
| `GET` / `PATCH` | `/api/v1/admin/settings` | parameter routing (`routing.*`) |
| `GET` | `/api/v1/admin/routing-attempts?gateway=&model=&from=&to=` | log fallback & error rate |
| `GET` | `/api/v1/admin/audit-logs` | jejak perubahan admin |

Setiap mutation admin: tulis `admin_audit_logs` + naikkan `app_settings['routing.version']` (invalidasi cache router).

## 3. Chat publik: SSE vs WebSocket

**Keputusan: SSE lewat `POST` + `fetch` stream, koneksi ditutup setelah event `done`.** Setuju dengan saran kamu.

| Aspek | SSE (POST stream) | WebSocket |
|---|---|---|
| Pola data | 1 request → 1 stream jawaban (persis kebutuhan chat) | full-duplex terus-menerus (berlebihan) |
| Next.js Route Handler | native (`new Response(ReadableStream)`) | tidak didukung di Route Handler, butuh server custom |
| Auth | cookie / header biasa per request | handshake + re-auth manual |
| Proxy/CDN/Nginx | HTTP biasa (cukup `X-Accel-Buffering: no`) | perlu konfigurasi upgrade |
| Skala | stateless, tidak ada koneksi menggantung | koneksi long-lived per user |
| Stop generate | `AbortController` di client → `request.signal` di server, + endpoint `/stop` | kirim pesan stop |

Catatan: pakai **`fetch()` + `ReadableStream` reader**, bukan `EventSource` (EventSource hanya GET dan tidak bisa kirim body/header).

### Format event

Header response:
```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
x-request-id: 0192f3a4-7c1e-7b2a-9d4e-3f6a8b1c2d3e
```

Urutan event:
```
event: meta
data: {"messageId":"0192f3a4-7c1e-7b2a-9d4e-3f6a8b1c2d3e","userMessageId":"0192f3a4-7c1e-7b2a-9d4e-3f6a8b1c2d3e","model":"openai/gpt-6-luna"}

event: reasoning        (opsional, berulang)
data: {"delta":"..."}

event: delta            (berulang)
data: {"delta":"Halo"}

event: tool             (opsional: tool call/result yang aman ditampilkan)
data: {"name":"web_search","status":"running"}

event: ping             (setiap ~15 detik saat menunggu, cegah idle timeout)
data: {}

event: done             (terakhir → server menutup stream)
data: {"finishReason":"stop","usage":{"promptTokens":120,"completionTokens":480}}

event: error            (alternatif terakhir → server menutup stream)
data: {"code":"MODEL_UNAVAILABLE","message":"The model is temporarily unavailable.","requestId":"0192f3a4-7c1e-7b2a-9d4e-3f6a8b1c2d3e"}
```

Aturan penting:
- **Fallback terjadi sebelum token pertama dikirim ke client.** Setelah `delta` pertama terkirim, gateway tidak diganti di tengah jawaban (jawaban akan campur); jika putus → `error` dan pesan disimpan `status='aborted'` (user bisa regenerate).
- Event `meta` **tidak pernah** berisi gateway/upstream. Fallback tidak terlihat oleh user.
- Server selalu mengakhiri dengan tepat satu `done` **atau** `error`, lalu `controller.close()`.
- Jika client disconnect (`request.signal` aborted) → abort fetch upstream, simpan pesan parsial `status='aborted'`.
- Pesan assistant disimpan ke DB saat selesai (status `streaming` → `completed`), bukan per token.

## 4. Apakah perlu multi-request / masking request?

**Jawaban singkat: tidak perlu memecah/menyamarkan request di sisi client.** Semua yang berjalan di browser bisa dibaca user lewat DevTools. Obfuscation, enkripsi payload di JS, atau memecah satu chat jadi banyak request tidak menambah keamanan: kuncinya ada di bundle JS yang sama, dan hanya menyulitkan debugging serta menambah latensi.

Keamanan yang benar adalah **membuat apa pun yang terlihat di DevTools tidak berharga**:

| Ancaman | Mitigasi (server-side) |
|---|---|
| User melihat gateway/upstream/API key | Client hanya tahu `openai/gpt-6-luna`. Request ke gateway terjadi server → server. Key terenkripsi di DB |
| Error bocorkan detail upstream | Error dinormalisasi ke kode publik (`MODEL_UNAVAILABLE`, `RATE_LIMITED`, `CONTEXT_TOO_LONG`…). Detail asli hanya di `routing_attempts` |
| Header/timing upstream bocor | Jangan forward header response upstream; ID respons upstream (`chatcmpl-…`) dibuang |
| Replay / pakai API dari script | Cookie sesi `HttpOnly; Secure; SameSite=Lax`, cek `Origin` di proxy, CSRF aman karena `SameSite` + cek Origin |
| Spam / abuse | Rate limit per user + per IP (`plans.requests_per_minute`), kuota token (`user_usage_periods`), batas panjang input & jumlah lampiran |
| Prompt injection memaksa model "bocorkan system prompt" | System prompt tidak berisi rahasia; info gateway tidak pernah masuk prompt |
| Pilih model yang tidak diizinkan | Server validasi `model` terhadap `catalog_models.status='active'` (dan plan user) |
| Akses chat orang lain | Setiap query di-scope `user_id` dari sesi (bukan dari body) |
| Enumerasi ID | ID publik UUIDv7 (`/c/[uuid]`), bukan auto-increment |

Yang **boleh** dilakukan untuk mengurangi "noise" di DevTools (kosmetik, bukan keamanan): payload minimal, tidak ada field internal, nama event generik.

## 5. Struktur folder (rencana)

```
src/
  proxy.ts                         # auth gate /api/v1/admin/**, Origin check, request-id
  app/api/v1/
    models/route.ts
    chats/route.ts
    chats/[chatId]/route.ts
    chats/[chatId]/messages/route.ts          # POST → SSE
    chats/[chatId]/messages/[messageId]/stop/route.ts
    admin/gateways/route.ts
    admin/gateways/[id]/route.ts
    admin/gateways/[id]/sync-models/route.ts
    admin/catalog-models/[id]/routes/route.ts
    ...
  lib/
    db/                 # prisma client singleton
    api/                # response helpers, error mapping, zod schemas, sse encoder
    auth/               # session cookie, requireUser(), requireAdmin()
    gateways/           # repository, crypto (AES-GCM), client (chat|responses wire), sync
    routing/            # resolveCandidates(), executeWithFallback(), circuit breaker, cache
    chat/               # chat service: simpan pesan, panggil routing, tools loop
    tools/              # (sudah ada)
    storage/            # (sudah ada)
```
