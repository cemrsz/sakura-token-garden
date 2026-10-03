# 🌸 Sakura Token Bahçesi

Yapay zekâ ajanların token harcadıkça yavaşça büyüyen ağaçlar. Her AI kendi ağaç türünü büyütür:

| AI | Ağaç | Final |
|---|---|---|
| **Claude Code** | 🌸 **Sakura** — Japon kiraz çiçeği; pembe tomurcuklar, çiçek bulutu | *Hanami* |
| **Codex** | 🍁 **Momiji** — Japon akçaağacı; yapraklar sararır, turuncuya ve kızıla döner | *Momijigari* |

Tohumdan başlar, filizlenir, dallanır, yapraklanır ve hedefe ulaşınca tam çiçeğe / tam sonbahara durur.
Hangi AI'ı kullanıyorsan onun ağacı büyür; ikisini birden kullanırsan bahçede yan yana iki ağaç olur.
Harcanan her token, ağaca uçan küçük bir ışık tanesi olarak görünür.

Hiçbir ayar, API anahtarı ya da hook gerekmez: uygulama ajanların zaten diske yazdığı transcript dosyalarını okur.

## Masaüstü uygulaması (önerilen)

**Kurulum dosyası:** `dist/SakuraTokenBahcesi-Kurulum-1.0.0.exe` — çift tıkla, kur, Başlat menüsünden aç.
Kurulumsuz denemek için: `dist/SakuraTokenBahcesi-1.0.0-portable.exe`.

- **Ana pencere:** bahçe, evreler, istatistikler, ayarlar. Kapatınca sistem tepsisine küçülür; ağaç büyümeye devam eder.
- **Widget:** çerçevesiz, her zaman üstte duran küçük pencere. Sürükleyerek taşınır, kenarından boyutlanır, konumu hatırlanır. Ana penceredeki ▣ düğmesi ya da tepsi menüsüyle açılır.
- **Sistem tepsisi (🌸):** Bahçeyi aç · Widget · Widget her zaman üstte · Windows açılışında başlat · Çıkış. Fare üstüne gelince ağaçların yüzdesi görünür.
- **Görev çubuğu:** uygulama simgesinde odaktaki ağacın ilerleme çubuğu.
- **Bildirim:** bir ağaç finale (Hanami / Momijigari) ulaştığında Windows bildirimi.

Kaynak koddan çalıştırmak için:

```bash
npm install
npm run app
```

Kurulum dosyasını yeniden üretmek için: `npm run dist` (çıktı `dist/` klasörüne).

## Tarayıcı sürümü

Node.js 18+ yeterli, paket kurulumu gerekmez.

| Dosya | Ne yapar |
|---|---|
| `Sakura.cmd` | Sunucuyu başlatır, tarayıcıda bahçeyi açar |
| `Sakura-Widget.cmd` | Edge/Chrome'u küçük uygulama penceresi olarak açar |
| `Sakura-Arkaplan.vbs` | Konsol penceresi olmadan başlatır + widget açar |
| `Sakura-Demo.cmd` | Sahte token akışıyla demo |

Adres: <http://127.0.0.1:4870> · Widget: <http://127.0.0.1:4870/?mode=widget>
Tarayıcıda **Üstte tut** düğmesi bahçeyi Chrome/Edge Picture‑in‑Picture penceresine taşır.

## Nasıl çalışır?

```
~/.claude/projects/**/*.jsonl   ─┐
                                 ├─► lib/tracker.js ─► lib/garden.js ─► lib/app-server.js ──SSE──► public/ (canvas bahçe)
~/.codex/sessions/**/*.jsonl    ─┘   (dosya kuyruğu)    (sezon, ölçü,     (127.0.0.1)          ▲
                                                         AI başına ağaç)                        └── desktop/ (Electron kabuğu)
```

- **Claude Code** her asistan yanıtını `usage` alanıyla yazar. Aynı yanıt her içerik bloğu için tekrar yazıldığından ve `--resume` eski mesajları yeni dosyaya kopyaladığından `message.id + requestId` ile tekilleştirilir.
- **Codex** oturum başına kümülatif `token_count` olayları yazar; ardışık toplamların farkı alınır, tekrarlanan olaylar ve devralınan (resume) toplamlar sayılmaz.
- Dosyalar sadece sona eklendiği için her dosyanın okunan bayt konumu tutulur; yarım satır, satır sonu gelene kadar bekletilir. `fs.watch` + yoklama ile yeni tokenlar ~1–2 sn içinde ağaca yansır.
- Ağaçlar tamamen prosedüreldir (görsel dosya yok): dallar, yapraklar, tomurcuklar ve çiçekler türün sabit tohumundan üretilir ve `ilerleme = token / hedef` ile büyür.

### Görünüm

- **Her AI'a ayrı ağaç** (varsayılan): bu sezon token harcayan her AI kendi ağacını büyütür. Codex'i çalıştırdığın anda Sakura'nın yanına bir Momiji dikilir. Panel en son çalışan AI'ın ağacını gösterir; alttaki AI çiplerine tıklayarak odağı değiştirebilirsin.
- **Tek ağaç:** tüm tokenlar tek ağaçta toplanır; türünü bu sezon en çok kullandığın AI belirler.

### Ölçüler

| Ölçü | Formül | Varsayılan hedef |
|---|---|---|
| **Ağırlıklı** (varsayılan) | girdi + önbelleğe yazma + çıktı + önbellekten okuma × 0,1 | 5M |
| Yeni tokenlar | girdi + önbelleğe yazma + çıktı | 1,5M |
| Sadece çıktı | çıktı (düşünme dahil) | 300K |
| Tümü | hepsi | 40M |

### Sezonlar

- **Günlük** (varsayılan): ağaçlar her gece yarısı yeniden tohumlanır. Alt paneldeki bahçe son 7 günü gösterir.
- **Manuel**: *Yeni tohum ek* butonuna basana kadar büyür; biten sezonlar bahçe geçmişine yazılır.

Ayarlar tarayıcı sürümünde `data/state.json`, masaüstü uygulamasında `%APPDATA%\sakura-token-garden\` altında saklanır.

## Önizleme ve demo

- `?preview=0.65&ai=claude|codex|both` — sunucu verisi olmadan belirli bir ilerlemeyi gösterir.
- `?preview=auto` — 0'dan 1'e tüm büyümeyi 45 saniyede oynatır.
- `npm run demo` (tarayıcı) veya `npm run app:demo` (masaüstü) — sahte ajan akışı.

## Gizlilik

- Sunucu yalnızca `127.0.0.1` adresini dinler; başka bilgisayarlardan erişilemez.
- Transcriptlerden yalnızca token sayıları, zaman damgası, oturum kimliği, model ve klasör adı kullanılır; mesaj içerikleri saklanmaz/kullanılmaz ve hiçbir veri makineden çıkmaz.
- Yabancı `Host` başlıkları (DNS rebinding) ve başka sitelerden gelen istekler reddedilir. Masaüstü penceresi yalnızca kendi yerel sunucusunu açar; sayfaya Node erişimi verilmez.

## Proje yapısı

```
desktop/main.js      Electron: ana pencere, widget, tepsi, bildirim, görev çubuğu
desktop/preload.js   Sayfaya açılan 3 komut (widget, ana pencere, çıkış)
desktop/make-icons.js İkonları kodla üretir (npm run icons)
server.js            Tarayıcı sürümü komut satırı
lib/app-server.js    HTTP + SSE sunucu (iki sürüm de kullanır)
lib/parsers.js       Claude & Codex satır → token olayı
lib/tracker.js       Klasör keşfi, dosya kuyruğu okuma, izleme
lib/garden.js        Ölçüler, sezonlar, AI başına ağaçlar, ayarlar
public/themes.js     AI → ağaç türü temaları (renk, şekil, evre adları)
public/tree.js       Prosedürel bahçe (canvas): bitkiler, sprite'lar, parçacıklar
public/app.js        Arayüz, SSE istemcisi, ayarlar, widget
test/                node:test birim + uçtan uca testler
```

Yeni bir AI eklemek için: `lib/parsers.js`'e çözümleyici, `lib/tracker.js`'e klasör, `public/themes.js`'e tema.

## Test

```bash
npm test
```

## Sorun giderme

- **Ağaç büyümüyor:** Ayarlar → *Kaynaklar* bölümünde "dosya izleniyor" yazmalı. Klasörler farklı yerdeyse `CLAUDE_CONFIG_DIR` veya `CODEX_HOME` ortam değişkenlerini ayarla.
- **Ağaç çok hızlı/yavaş büyüyor:** Ayarlar → *Hedef*.
- **Windows SmartScreen uyarısı:** kurulum dosyası imzalı değil; "Ek bilgi → Yine de çalıştır".
