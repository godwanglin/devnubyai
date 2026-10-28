# 03 — Smart Routing & Fallback (Draft)

> Status: **Disetujui — belum diimplementasi** (dikerjakan di Phase 3). Tabel & setting `routing.*` sudah ada sejak Phase 1.
> **Aturan wajib:** smart routing & fallback **tidak boleh di-hardcode**. Gateway, kandidat, urutan, kode error yang memicu fallback, batas percobaan, dan circuit breaker semuanya dibaca dari DB (`gateways`, `catalog_model_routes`, `app_settings`) dan diatur admin di `/admin/model-catalog`. Lihat `ARCHITECTURE_RULES.md` §9.

## 1. Sumber konfigurasi

| Data | Tabel | Diatur di |
|---|---|---|
| Daftar gateway, base URL, wire API, key, primary, enabled, timeout | `gateways` | `/admin/model-catalog` → tab **Gateways** |
| Model upstream tiap gateway | `upstream_models` | tab **Katalog Upstream** (tombol Sync) |
| Model publik + logo provider | `catalog_models`, `model_providers` | tab **Katalog Chat** |
| Kandidat berurutan per model publik | `catalog_model_routes` | tab **Katalog Chat** → panel "Routing" |
| Parameter retry / circuit / cache | `app_settings` (`routing.*`) | tab **Routing Settings** |

`.env` hanya menyimpan `DATABASE_URL` dan `GATEWAY_SECRET_KEY` (kunci dekripsi API key). Variabel `GATEWAY_UPSTREAM`, `GATEWAY_API_KEY`, `WIRE_API`, `MODEL_CATALOG_PATH` yang ada sekarang **dipindahkan sekali** ke tabel `gateways` lewat seed/admin, lalu dihapus dari `.env`.

## 2. Resolusi kandidat (`resolveCandidates(publicModelId)`)

1. Ambil `catalog_models` dengan `status='active'`. Jika tidak ada → error publik `MODEL_NOT_FOUND`.
2. Ambil `catalog_model_routes` (`is_enabled=1`) JOIN `upstream_models` (`is_available=1`) JOIN `gateways` (`is_enabled=1`), urut `priority ASC`.
3. Jika `routing.primary_first = true`: kandidat yang gateway-nya `is_primary=1` dipindah ke depan (urutan relatif tetap menurut `priority`). Jika `false`: murni `priority`.
4. Buang kandidat yang gateway-nya `circuit_open_until > now()`. Jika semuanya terbuang → coba yang circuit-nya paling cepat berakhir (half-open) agar tidak total down.
5. Potong ke `routing.max_attempts`.

Contoh `openai/gpt-6-luna`:
```
priority 1  Gateway A (primary)  gpt-6-luna
priority 2  Gateway B            gpt-5.6-luna
priority 3  Gateway C            gpt-5.6-luna
→ urutan percobaan: A → B → C
```
Jika admin mengubah primary ke Gateway C, urutan otomatis menjadi C → A → B tanpa deploy ulang.

Hasil resolusi di-cache di memori per `public_id`, dengan kunci `routing.version`; TTL `routing.cache_ttl_seconds`. Setiap perubahan admin menaikkan `routing.version` → cache langsung tidak valid.

## 3. Eksekusi dengan fallback (`executeWithFallback`)

```
for (attempt, candidate) in candidates:
    request = buildRequest(candidate.gateway.wire_api, candidate.model_key, body, candidate.param_overrides)
    try:
        stream = fetch(candidate.gateway.base_url + path, timeout = gateway.timeout_ms,
                       firstTokenTimeout = gateway.first_token_timeout_ms)
        tunggu token/chunk pertama
        log attempt(outcome='success'); reset consecutive_failures
        return stream   // dari titik ini TIDAK ADA fallback lagi
    catch err:
        klasifikasi err → error_class
        log attempt(outcome='fallback' | 'failed')
        catat kegagalan gateway (consecutive_failures++, buka circuit jika ≥ threshold)
        if not isRetryable(error_class, settings): break
throw PublicError('MODEL_UNAVAILABLE')
```

### Klasifikasi error → fallback?

| error_class | Contoh | Fallback? (default seed, dapat diubah admin) |
|---|---|---|
| `timeout` | koneksi / first-token timeout | ya |
| `network` | DNS, ECONNRESET, TLS | ya |
| `http_5xx` | 500/502/503/504 | ya (`routing.retry_on_status`) |
| `rate_limited` | 429 | ya |
| `model_not_found` | 404 / `model_not_found` | ya (`routing.fallback_on_model_not_found`) |
| `auth` | 401/403 dari gateway | ya + tandai gateway `degraded` (key salah adalah masalah gateway, bukan user) |
| `bad_request` | 400 karena input user (konteks terlalu panjang, konten ditolak) | **tidak** → error ke user (gateway lain kemungkinan menolak hal sama) |
| `client_aborted` | user stop / tutup tab | tidak, `outcome='aborted'` |

Daftar status yang memicu fallback disimpan di `app_settings`, bukan konstanta kode. Yang ada di kode hanya **mekanisme klasifikasi** (memetakan respons mentah ke `error_class`).

## 4. Circuit breaker & health

- Gagal berturut-turut ≥ `routing.circuit_failure_threshold` → `circuit_open_until = now + routing.circuit_cooldown_seconds`, `health_status='down'`.
- Setelah cooldown: half-open, 1 request percobaan; sukses → `healthy`, `consecutive_failures=0`.
- Update kolom health dilakukan "fire-and-forget" (tidak memblokir stream).
- Admin bisa reset circuit manual dari panel.

## 5. Adapter wire API

Router menerima format internal tunggal (mirip OpenAI chat messages) lalu adapter per `gateways.wire_api`:

| `wire_api` | Endpoint | Parsing stream |
|---|---|---|
| `chat` | `POST {base_url}/chat/completions` | `data: {choices[0].delta.content / reasoning_content}` |
| `responses` | `POST {base_url}/responses` | event `response.output_text.delta`, `response.reasoning…`, `response.completed` |

Output kedua adapter dinormalisasi ke event internal (`delta`, `reasoning`, `tool_call`, `usage`, `finish`) → diubah jadi SSE publik (lihat `02-api-routing.md` §3). Menambah wire API baru = menambah adapter + nilai `CHECK`; tidak mengubah router.

## 6. Admin UI `/admin/model-catalog`

Sub-tab:

1. **Gateways** — tabel gateway: nama, base URL, wire API, primary (radio, hanya satu), enabled, health badge, last sync, tombol *Test* / *Sync models* / *Reset circuit*. Form API key write-only (tampil `••••last4`).
2. **Katalog Upstream** — filter per gateway, cari `model_key`, badge available/hilang, `last_seen_at`. Read-only + tombol Sync per gateway / Sync semua.
3. **Katalog Chat** — daftar `catalog_models`:
   - form: `public_id` (`openai/gpt-6-luna`), display/short name, deskripsi, kategori (Powerful/Fast), badge, capability (vision/tools/reasoning), status, urutan.
   - **Logo picker**: grid provider dari `model_providers` (preview logo).
   - **Panel Routing**: daftar kandidat drag-and-drop (urutan = `priority`); tambah kandidat via combobox yang mencari `upstream_models` lintas gateway (`gpt-5.6-luna — Gateway B`); toggle enable per kandidat; ikon ⭐ di kandidat dengan gateway primary; peringatan bila kandidat upstream `is_available=0` atau gateway disabled.
   - Tombol **Dry run** → menampilkan urutan percobaan final.
4. **Routing Settings** — form untuk semua key `routing.*`.
5. **Logs** — tabel `routing_attempts` + ringkasan error rate per gateway (24 jam).

## 7. Logo provider (seed `model_providers`)

Logo disimpan sebagai SVG lokal di `public/brand-logos/{logo_key}.svg` (sumber: set ikon open-source **LobeHub Icons** `@lobehub/icons-static-svg`, lisensi MIT — tidak hotlink). Admin juga bisa upload logo custom (R2) → `logo_url`.

| slug | name | logo_key |
|---|---|---|
| `openai` | OpenAI | `openai` |
| `anthropic` | Anthropic | `claude` |
| `google` | Google Gemini | `gemini` |
| `deepseek` | DeepSeek | `deepseek` |
| `xai` | xAI Grok | `grok` |
| `meta` | Meta Llama | `meta` |
| `mistral` | Mistral AI | `mistral` |
| `qwen` | Qwen (Alibaba) | `qwen` |
| `moonshot` | Moonshot Kimi | `kimi` |
| `zhipu` | Zhipu GLM | `zhipu` |
| `minimax` | MiniMax | `minimax` |
| `cohere` | Cohere | `cohere` |
| `perplexity` | Perplexity | `perplexity` |
| `devnuby` | Devnuby (custom) | `devnuby` |

## 8. Yang sengaja TIDAK dilakukan

- Load balancing acak / weighted antar gateway (bisa ditambah nanti via kolom `weight`, tetap dari DB).
- Fallback di tengah stream (menghasilkan jawaban campur).
- Menyimpan gateway/upstream di pesan chat atau mengirimnya ke client.
