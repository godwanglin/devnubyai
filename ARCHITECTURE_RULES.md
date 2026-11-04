# Devnuby AI — Architecture & Development Rules

Dokumen ini adalah aturan wajib yang disepakati untuk pengembangan web Devnuby AI.

## 1. Aturan Wajib
1. **Modularitas Penuh**: Setiap fitur dipecah ke module terpisah (`components/ui`, `components/chat`, `components/sidebar`, `components/settings`, `lib`, `hooks`, `data`, `messages`).
2. **Komponen Reusable (DRY)**:
   - Dilarang membuat ulang tombol, input, dropdown, popover, modal, dialog, badge, tooltip.
   - Semua elemen interaktif memakai komponen dari `@/components/ui/` (`button.tsx`, `input.tsx`, `dropdown.tsx`, `popover.tsx`, `modal.tsx`, `tooltip.tsx`, `slider.tsx`).
3. **Batas Baris File**:
   - Maksimal 500 baris per file.
   - Toleransi absolut: 600 baris. Jika mendekati 500 baris, wajib di-refactor / dipecah ke sub-komponen atau custom hook.
4. **Struktur Folder Rapi & Bersih**:
   - `src/app/` — Halaman App Router (`(chat)/page.tsx`, `(chat)/c/[id]/page.tsx`, `login/page.tsx`, `settings/page.tsx`, dll.)
   - `src/components/ui/` — Primitif reusable (button, input, modal, tooltip, popover, dropdown, slider)
   - `src/components/chat/` — Komponen khusus chat (composer, message-list, ai-message, markdown-renderer, model-selector)
   - `src/components/sidebar/` — Sidebar, history group, user-card, quota-meter
   - `src/components/modals/` — Dialog settings, share, confirm delete
   - `src/data/` — Data dummy JSON terpusat (`models.json`, `sessions.json`, `user.json`, `quick-prompts.json`)
   - `src/lib/` — Utilitas murni (`cn`, `storage`, `slug`)
   - `src/hooks/` — Custom hooks (`useTheme`, `useChatSession`, `useMediaQuery`, `useI18n`)
   - `src/messages/` atau `src/i18n/` — Dictionary terpusat (`id.json`, `en.json`)
5. **Tech Stack & Libraries**:
   - **Framework**: Next.js App Router (TypeScript, React 19 / latest)
   - **Styling**: Tailwind CSS + CSS variables untuk tema Next.js Pure Dark (`#000000`, `#0A0A0A`, `#111111`, `#292929`, teks `#EDEDED`) dan Glassmorphism (`backdrop-blur-[3px]`, border hairline `rgba(255,255,255,0.11)`).
   - **Icons**: `lucide-react`
   - **Markdown Renderer**: `react-markdown` + `remark-gfm` + `rehype-highlight` / prism (dukungan code block, table, checklist, math/quote, copy button).
   - **i18n**: Sistem dictionary terpusat (`id.json`, `en.json`) via lightweight Context hook `useI18n` tanpa bloatware, mudah dikonversi ke `next-intl`.
   - **Dummy Data**: Terpusat di `src/data/*.json` agar mudah diganti integrasi API backend / server action nantinya.
6. **URL & Routing**:
   - Beranda: `/` (percakapan baru)
   - Sesi chat: `/c/[uuid]` — UUIDv7 dari `chat_sessions.public_id` (contoh: `/c/0192f3a4-7c1e-7b2a-9d4e-3f6a8b1c2d3e`). Dummy slug lama (`sess-...`) diganti saat chat terhubung ke DB.
   - Autentikasi: `/login` (dengan tombol *Login with Google*)
   - Pengaturan: `/settings` (profile, models, quota, appearance, language)
7. **React & Performance Best Practices**:
   - Direct / optimized imports dari `lucide-react`.
   - Client components hanya jika butuh interaktivitas (`'use client'`).
   - Server components untuk layout statis / initial dummy loader.
   - Hindari layout shifts, hormati `prefers-reduced-motion`.
   - Anti-flash script untuk tema dan bahasa di `<head>`.
8. **Public Preview**: Gunakan skill `public-preview` jika pengguna meminta link publik.
9. **Smart Routing & Fallback Wajib Diatur Admin (Dilarang Hardcode)**:
   - Daftar gateway/upstream, gateway primary, model publik, kandidat fallback beserta urutannya, kode error pemicu fallback, batas percobaan, circuit breaker, dan TTL cache **wajib** dibaca dari database (`gateways`, `upstream_models`, `catalog_models`, `catalog_model_routes`, `app_settings`) dan diatur lewat admin panel `/admin/model-catalog`.
   - Dilarang menaruh URL gateway, API key gateway, nama model upstream, atau urutan fallback di kode maupun `.env`. `.env` hanya boleh berisi `DATABASE_URL` dan kunci enkripsi `GATEWAY_SECRET_KEY`.
   - Kode hanya berisi **mekanisme** (resolver, adapter wire API, klasifikasi error); **kebijakan** selalu dari DB. Key setting yang hilang = error konfigurasi, bukan nilai cadangan di kode.
   - Identitas gateway/upstream tidak pernah dikirim ke client. Detail desain: `.plans/03-smart-routing.md`.
10. **API**: Semua endpoint di bawah `/api/v1` (Route Handler). Chat publik memakai SSE (`POST` + `text/event-stream`) dan stream ditutup setelah event `done`/`error`. Detail: `.plans/02-api-routing.md`.

11. cara deploy ada di `DEPLOY_RULE.md`