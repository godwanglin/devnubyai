# 📊 Laporan Lengkap Benchmark Latensi Redis Caching DevNuby AI

**Waktu Pengujian:** 1/11/2026, 19.33.49
**Metodologi:**
- **Sebelum Cache:** Redis di-invalidate/flush sebelum setiap iterasi sehingga 100% request membebani PostgreSQL database.
- **Sesudah Cache:** Redis di-warmup terlebih dahulu sehingga 100% request dilayani langsung dari Redis in-memory cache.
- **Ukuran Sampel:** 50 iterasi per endpoint (+ 5 warm-up)

## 1. Tabel Perbandingan Latensi & Peningkatan Kecepatan (*Speedup*)

| No | Endpoint & Fitur | Sebelum (p50) | Sebelum (Mean) | Sebelum (p95) | Sesudah (p50) | Sesudah (Mean) | Sesudah (p95) | Peningkatan (*Speedup* Mean) | Peningkatan (*Speedup* p95) |
|:--:|:-----------------|:-------------:|:--------------:|:-------------:|:-------------:|:--------------:|:-------------:|:----------------------------:|:---------------------------:|
| 1 | **Plans & Pricing**<br>/api/v1/plans | 139.61 ms | **155.88 ms** | 226.56 ms | 40.18 ms | **40.88 ms** | 45.57 ms | **3.8x** (74% lebih cepat) | **5x** |
| 2 | **Payment Methods**<br>/api/v1/payments/methods | 90.67 ms | **103.26 ms** | 175.41 ms | 39.76 ms | **46.2 ms** | 97.12 ms | **2.2x** (55% lebih cepat) | **1.8x** |
| 3 | **Public Shared Chat**<br>/api/v1/share/01a1883d-a4a7-7b41-a391-54bc2684b2d4 | 225.55 ms | **277.99 ms** | 716.45 ms | 71.39 ms | **86.77 ms** | 148.02 ms | **3.2x** (69% lebih cepat) | **4.8x** |
| 4 | **Rate Limiting & Quota**<br>/api/v1/me/quota | 120.06 ms | **160.75 ms** | 445.6 ms | 48.01 ms | **74.68 ms** | 200.45 ms | **2.2x** (54% lebih cepat) | **2.2x** |
| 5 | **System Prompts / Personas**<br>/api/v1/admin/system-prompts | 104.39 ms | **118.47 ms** | 195.06 ms | 51.8 ms | **66.57 ms** | 115.77 ms | **1.8x** (44% lebih cepat) | **1.7x** |
| 6 | **User Profile Metadata**<br>/api/v1/me | 68.32 ms | **87.44 ms** | 183.47 ms | 51.42 ms | **63.77 ms** | 131.72 ms | **1.4x** (27% lebih cepat) | **1.4x** |
| 7 | **Active Login Sessions**<br>/api/v1/user/sessions | 104.23 ms | **119.35 ms** | 187.35 ms | 46.83 ms | **52.37 ms** | 77.02 ms | **2.3x** (56% lebih cepat) | **2.4x** |

## 2. Rincian Metrik Lengkap: Sebelum Cache (100% Database)

| Endpoint | Min | p50 (Median) | Mean (Rata-rata) | p95 | p99 | Max | Success Rate |
|:---------|:---:|:------------:|:----------------:|:---:|:---:|:---:|:------------:|
| /api/v1/plans | 130.54 ms | 139.61 ms | **155.88 ms** | 226.56 ms | 409.91 ms | 409.91 ms | 100% |
| /api/v1/payments/methods | 82.36 ms | 90.67 ms | **103.26 ms** | 175.41 ms | 208.84 ms | 208.84 ms | 100% |
| /api/v1/share/01a1883d-a4a7-7b41-a391-54bc2684b2d4 | 167.97 ms | 225.55 ms | **277.99 ms** | 716.45 ms | 822.27 ms | 822.27 ms | 100% |
| /api/v1/me/quota | 86.03 ms | 120.06 ms | **160.75 ms** | 445.6 ms | 524.91 ms | 524.91 ms | 100% |
| /api/v1/admin/system-prompts | 83.46 ms | 104.39 ms | **118.47 ms** | 195.06 ms | 251.02 ms | 251.02 ms | 100% |
| /api/v1/me | 60.31 ms | 68.32 ms | **87.44 ms** | 183.47 ms | 511.25 ms | 511.25 ms | 100% |
| /api/v1/user/sessions | 84.41 ms | 104.23 ms | **119.35 ms** | 187.35 ms | 195.74 ms | 195.74 ms | 100% |

## 3. Rincian Metrik Lengkap: Sesudah Cache (100% Redis In-Memory)

| Endpoint | Min | p50 (Median) | Mean (Rata-rata) | p95 | p99 | Max | Success Rate |
|:---------|:---:|:------------:|:----------------:|:---:|:---:|:---:|:------------:|
| /api/v1/plans | 37.88 ms | 40.18 ms | **40.88 ms** | 45.57 ms | 52 ms | 52 ms | 100% |
| /api/v1/payments/methods | 36.76 ms | 39.76 ms | **46.2 ms** | 97.12 ms | 103.89 ms | 103.89 ms | 100% |
| /api/v1/share/01a1883d-a4a7-7b41-a391-54bc2684b2d4 | 63.02 ms | 71.39 ms | **86.77 ms** | 148.02 ms | 304.34 ms | 304.34 ms | 100% |
| /api/v1/me/quota | 38.09 ms | 48.01 ms | **74.68 ms** | 200.45 ms | 305.64 ms | 305.64 ms | 100% |
| /api/v1/admin/system-prompts | 41.88 ms | 51.8 ms | **66.57 ms** | 115.77 ms | 156.27 ms | 156.27 ms | 100% |
| /api/v1/me | 38.03 ms | 51.42 ms | **63.77 ms** | 131.72 ms | 159.11 ms | 159.11 ms | 100% |
| /api/v1/user/sessions | 38.58 ms | 46.83 ms | **52.37 ms** | 77.02 ms | 108.95 ms | 108.95 ms | 100% |
