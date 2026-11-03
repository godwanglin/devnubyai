/**
 * Starter copy for the public legal pages. It is written to app_settings
 * (`legal.pages`) on first read; from then on the admin panel owns the text.
 */

export interface LegalSection {
  title: string;
  body: string;
}

export const DEFAULT_ABOUT_TEXT =
  "Devnuby AI adalah platform asisten kecerdasan buatan (AI) berbasis web untuk membantu individu, pelajar, profesional, dan pengembang di Indonesia bekerja lebih cepat. Pengguna dapat bercakap dengan model AI, menganalisis file, serta membuat dokumen Word, Excel, dan PowerPoint langsung dari percakapan.";

export const DEFAULT_ABOUT_HIGHLIGHTS: LegalSection[] = [
  {
    title: "Asisten AI serbaguna",
    body: "Tanya jawab, menulis, merangkum, menerjemahkan, dan membantu pemrograman dalam satu antarmuka yang sederhana.",
  },
  {
    title: "Pembuatan dokumen",
    body: "Hasilkan CV, proposal, laporan, spreadsheet, dan presentasi dalam format .docx, .xlsx, dan .pptx yang siap diunduh.",
  },
  {
    title: "Privasi terjaga",
    body: "Percakapan dan file pengguna disimpan dengan aman dan tidak pernah dijual kepada pihak ketiga.",
  },
  {
    title: "Pembayaran lokal resmi",
    body: "Langganan dibayar melalui payment gateway resmi di Indonesia (QRIS, Virtual Account, e-wallet) dan aktif otomatis.",
  },
];

export const DEFAULT_TERMS_SECTIONS: LegalSection[] = [
  {
    title: "1. Penerimaan Ketentuan",
    body: "Dengan membuat akun atau menggunakan layanan Devnuby AI, Anda menyatakan telah membaca, memahami, dan menyetujui Syarat & Ketentuan ini. Jika tidak setuju, mohon untuk tidak menggunakan layanan.",
  },
  {
    title: "2. Deskripsi Layanan",
    body: "Devnuby AI menyediakan layanan asisten AI berbasis web, termasuk percakapan dengan model AI, analisis file, dan pembuatan dokumen. Layanan tersedia dalam paket gratis dan paket berbayar dengan batas penggunaan (kuota) yang berbeda-beda sesuai halaman Paket & Harga.",
  },
  {
    title: "3. Akun Pengguna",
    body: "Anda wajib memberikan data yang benar saat mendaftar dan bertanggung jawab menjaga kerahasiaan akun. Satu akun hanya untuk satu pengguna. Kami berhak menangguhkan akun yang terindikasi disalahgunakan.",
  },
  {
    title: "4. Paket Berlangganan & Pembayaran",
    body: "Harga paket tercantum di halaman Paket & Harga dalam Rupiah. Pembayaran diproses oleh payment gateway resmi; Devnuby AI tidak menyimpan data kartu atau rekening Anda. Paket aktif otomatis setelah pembayaran terkonfirmasi dan berlaku sesuai periode yang dipilih (bulanan/tahunan). Paket tidak diperpanjang otomatis kecuali Anda melakukan pembayaran baru.",
  },
  {
    title: "5. Penggunaan yang Dilarang",
    body: "Anda dilarang menggunakan layanan untuk aktivitas yang melanggar hukum Republik Indonesia, termasuk penipuan, ujaran kebencian, konten pornografi, pelanggaran hak cipta, penyebaran malware, spam, atau upaya membobol sistem. Pelanggaran dapat mengakibatkan penghentian akun tanpa pengembalian dana.",
  },
  {
    title: "6. Konten & Hak Kekayaan Intelektual",
    body: "Konten yang Anda masukkan tetap menjadi milik Anda. Hasil yang dibuat AI dapat Anda gunakan secara bebas, namun Anda bertanggung jawab memeriksa ketepatan dan kesesuaiannya sebelum digunakan. Merek, logo, dan perangkat lunak Devnuby AI adalah milik kami.",
  },
  {
    title: "7. Batasan Tanggung Jawab",
    body: "Jawaban AI dapat mengandung kesalahan dan bukan merupakan nasihat hukum, medis, atau keuangan profesional. Layanan disediakan sebagaimana adanya; kami tidak bertanggung jawab atas kerugian tidak langsung akibat penggunaan hasil AI.",
  },
  {
    title: "8. Perubahan Ketentuan",
    body: "Kami dapat memperbarui Syarat & Ketentuan ini sewaktu-waktu. Tanggal pembaruan terakhir selalu dicantumkan di halaman ini, dan penggunaan layanan setelah perubahan berarti Anda menyetujui ketentuan yang baru.",
  },
];

export const DEFAULT_PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: "1. Data yang Kami Kumpulkan",
    body: "Kami mengumpulkan data akun (nama, email, foto profil dari login Google), isi percakapan dan file yang Anda unggah, data transaksi (nomor invoice, paket, status pembayaran), serta data teknis seperti alamat IP, jenis perangkat, dan log akses untuk keamanan.",
  },
  {
    title: "2. Penggunaan Data",
    body: "Data digunakan untuk menyediakan dan meningkatkan layanan, memproses pembayaran dan aktivasi paket, menghitung kuota penggunaan, menjaga keamanan akun, serta menanggapi permintaan dukungan.",
  },
  {
    title: "3. Pembayaran",
    body: "Pembayaran diproses langsung oleh payment gateway resmi yang terdaftar di Indonesia. Devnuby AI tidak pernah menyimpan nomor kartu, PIN, atau kredensial perbankan Anda; kami hanya menerima status dan referensi transaksi.",
  },
  {
    title: "4. Berbagi Data dengan Pihak Ketiga",
    body: "Kami tidak menjual data pribadi Anda. Data hanya dibagikan seperlunya kepada mitra yang dibutuhkan untuk menjalankan layanan, yaitu penyedia model AI (untuk memproses pesan Anda), payment gateway, dan penyedia infrastruktur penyimpanan, atau bila diwajibkan oleh hukum.",
  },
  {
    title: "5. Keamanan & Penyimpanan",
    body: "Data dikirim melalui koneksi terenkripsi (HTTPS/TLS) dan disimpan di server dengan kontrol akses terbatas. Data disimpan selama akun Anda aktif atau selama dibutuhkan untuk kewajiban hukum.",
  },
  {
    title: "6. Hak Anda",
    body: "Anda dapat mengakses, mengekspor, dan menghapus riwayat percakapan dari halaman Pengaturan, serta meminta penghapusan akun melalui kontak support kami.",
  },
];

export const DEFAULT_REFUND_SECTIONS: LegalSection[] = [
  {
    title: "1. Syarat Pengembalian Dana",
    body: "Pengembalian dana dapat diajukan paling lambat 1x24 jam sejak pembayaran berhasil apabila: (a) paket tidak aktif setelah pembayaran terkonfirmasi, (b) terjadi pembayaran ganda untuk transaksi yang sama, atau (c) layanan tidak dapat diakses sama sekali karena gangguan dari pihak kami dan kuota paket belum digunakan.",
  },
  {
    title: "2. Kondisi yang Tidak Dapat Direfund",
    body: "Pengembalian dana tidak berlaku untuk paket yang kuotanya sudah digunakan, pembatalan karena berubah pikiran setelah lewat 1x24 jam, atau akun yang dihentikan karena melanggar Syarat & Ketentuan.",
  },
  {
    title: "3. Cara Pengajuan",
    body: "Hubungi support melalui WhatsApp atau email yang tercantum di halaman Kontak dengan menyertakan email akun, nomor invoice, dan alasan pengajuan. Tim kami akan memverifikasi dan memberi jawaban paling lambat 2 hari kerja.",
  },
  {
    title: "4. Proses Pengembalian",
    body: "Dana yang disetujui dikembalikan ke rekening atau e-wallet milik pembayar dalam 3–14 hari kerja, tergantung metode pembayaran yang digunakan. Paket terkait akan dinonaktifkan setelah refund diproses.",
  },
];
