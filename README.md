# 🌸 Sakura Token Bahçesi

Yapay zekâ ajanların token harcadıkça ve sen VS Code'da kod yazdıkça yavaşça büyüyen ağaçlar.
Her kaynak kendi ağaç türünü büyütür:

| Kaynak | Ağaç | Neyle büyür | Final |
|---|---|---|---|
| **Claude Code** | 🌸 **Sakura** — kiraz çiçeği | token | *Hanami* |
| **Codex** | 🍁 **Momiji** — Japon akçaağacı | token | *Momijigari* |
| **VS Code** | 🪻 **Fuji** — morsalkım | elle yazılan kod satırı | *Fujimatsuri* |

Tohumdan başlar, filizlenir, dallanır, yapraklanır ve hedefe ulaşınca tam çiçeğe durur.
Tamamlanan ağacı **Bahçem**'e dikersin; yerine yeni bir tohum büyümeye başlar.
Token ve satır geçmişin bilgisayarındaki bir veritabanında **günlük ve haftalık** tutulur.

Hiçbir API anahtarı ya da hook gerekmez: uygulama ajanların diske yazdığı transcriptleri ve VS Code eklentisinin
yerel kayıtlarını okur. Hiçbir veri bilgisayarından çıkmaz.

## Kurulum

### Masaüstü uygulaması (önerilen)

`dist/SakuraTokenBahcesi-Kurulum-1.1.0.exe` — çift tıkla, kur, Başlat menüsünden aç.
Kurulumsuz: `dist/SakuraTokenBahcesi-1.1.0-portable.exe`. (GitHub'da *Releases* sayfasında da var.)

- **Ana pencere:** bahçe, evreler, istatistikler, ayarlar. Kapatınca sistem tepsisine küçülür.
- **Widget:** çerçevesiz, her zaman üstte duran küçük pencere; sürükle, boyutlandır, konumu hatırlanır.
- **Sistem tepsisi (🌸):** Bahçeyi aç · Widget · Her zaman üstte · Windows açılışında başlat · Çıkış.
- **Görev çubuğu** ilerleme çubuğu ve hedefe ulaşınca **Windows bildirimi**.

### VS Code eklentisi (kod satırları için)

```bash
code --install-extension vscode-extension/sakura-code-garden-1.0.0.vsix
```

Kurduktan sonra VS Code penceresini yeniden yükle (*Developer: Reload Window*). Durum çubuğunda `🪻 N satır` görünür.

**Sayılan:** o satırda gerçekten tuşa basarak yazıp Enter ile bitirdiğin satırlar.
**Sayılmayan:** yapıştırma, Copilot/AI tamamlama ve düzenlemeleri, snippet'ler, otomatik biçimlendirme, geri al / yinele, boş satırlar.
Uygulama kapalıyken de sayar; açınca okunur. Cursor için: `cursor --install-extension …vsix`.

### Tarayıcı sürümü

Node.js 22.5+ yeterli (veritabanı için yerleşik SQLite), paket kurulumu gerekmez.

| Dosya | Ne yapar |
|---|---|
| `Sakura.cmd` | Sunucuyu başlatır, tarayıcıda açar |
| `Sakura-Widget.cmd` | Edge/Chrome'u küçük uygulama penceresi olarak açar |
| `Sakura-Uygulama.cmd` | Masaüstü uygulamasını kaynak koddan açar |
| `Sakura-Arkaplan.vbs` | Konsolsuz başlatır + widget |
| `Sakura-Demo.cmd` | Sahte token akışıyla demo |

## Bahçem

Bir ağaç hedefe ulaşınca panelde **“Bahçeye dik”** düğmesi çıkar. Dikince ağaç Bahçem'e geçer,
aktif ağaç tohumdan yeniden başlar; hedefin üstündeki fazla yeni ağaca devreder (ör. %224 → dik → %124 → dik → %24).

- Dikmeyi unutursan, **sezon sonunda** (gece yarısı ya da *Yeni tohum*) tamamlanmış ağaçlar kendiliğinden dikilir.
- Her ağaç kendi tohumuyla büyür; bahçedeki iki Sakura birbirinin aynısı olmaz.
- Bahçe ekranı perspektifli bir çayır: eski ağaçlar arkada, yeniler önde. Üzerine gelince ayrıntı; **Liste** görünümü de var.

## İstatistikler

Araç çubuğundaki grafik düğmesi:

- **Özet:** bugün · dün · bu hafta (geçen haftaya göre %) · geçen hafta · son 30 gün
- **Günlük (30 gün) / Haftalık (12 hafta, pazartesi başlar)** yığılmış çubuklar, kaynaklara göre renkli; günlük görünümde hedef çizgisi
- **Token / Kod satırı** birimi, **Grafik / Tablo** görünümü, **CSV indir**

Veritabanı: `%APPDATA%\sakura-token-garden\data\sakura.db` (SQLite). İlk açılışta bilgisayardaki tüm geçmiş
birkaç saniyede içe aktarılır; uygulama kapalı kaldığı günler sonraki açılışta tamamlanır. Her model çağrısı tekil
bir kimlikle saklandığı için hiçbir şey iki kez sayılmaz. Herhangi bir SQLite aracıyla `daily_usage`, `weekly_usage`
ve `garden` tablolarını sorgulayabilirsin.

## Nasıl çalışır?

```
~/.claude/projects/**/*.jsonl          ─┐
~/.codex/sessions/**/*.jsonl           ─┼─► lib/tracker.js ─► lib/db.js (SQLite)   ─► lib/stats.js (günlük/haftalık)
%APPDATA%/sakura-token-garden/vscode/  ─┘   (dosya kuyruğu)  └► lib/garden.js (sezon, ağaçlar, hasat)
        ▲ VS Code eklentisi                                        └► lib/app-server.js ──SSE──► public/ (canvas)
                                                                                                  ▲ desktop/ (Electron)
```

- **Claude Code** yanıt başına `usage` yazar; aynı yanıt her içerik bloğu için tekrarlandığından `message.id + requestId` ile tekilleştirilir.
- **Codex** kümülatif `token_count` yazar; ardışık farklar alınır, resume ile devralınan toplam sayılmaz.
- **VS Code eklentisi** elle yazılan satırları 5 sn'de bir yerel JSONL dosyasına ekler.

### Ölçüler ve hedefler

| Ölçü (token) | Formül | Varsayılan hedef |
|---|---|---|
| **Ağırlıklı** | girdi + önbelleğe yazma + çıktı + önbellekten okuma × 0,1 | 5M |
| Yeni tokenlar | girdi + önbelleğe yazma + çıktı | 1,5M |
| Sadece çıktı | çıktı (düşünme dahil) | 300K |
| Tümü | hepsi | 40M |

Kod hedefi (VS Code): **50 · 100 · 250 · 1000 · 5000** satır (varsayılan 250) ya da özel.

**Görünüm:** *Her AI'a ayrı ağaç* (varsayılan) ya da *Tek ağaç* (tokenlar birleşir). VS Code ağacı her zaman ayrıdır.
**Sezon:** *Günlük* (her gece yeni tohum) ya da *Manuel* (*Yeni tohum ek*'e kadar).

## Önizleme ve demo

- `?preview=0.65&ai=claude|codex|vscode|both|all` — sunucu verisi olmadan önizleme
- `?preview=auto` — tüm büyümeyi 45 saniyede oynatır
- `npm run demo` / `npm run app:demo` — sahte ajan akışı

## Gizlilik

- Sunucu yalnızca `127.0.0.1`'i dinler; yabancı `Host`/`Origin` istekleri reddedilir.
- Transcriptlerden yalnızca sayılar, zaman, oturum, model ve klasör adı kullanılır; mesaj içerikleri saklanmaz.
- VS Code eklentisi kod içeriğini değil, yalnızca satır/karakter sayısını, dili ve klasör adını kaydeder.

## Proje yapısı

```
desktop/            Electron: pencereler, tepsi, bildirim, ikon üretimi
vscode-extension/   VS Code eklentisi (elle yazılan satırlar)
lib/parsers.js      Claude / Codex / VS Code satır → olay (tekil id)
lib/tracker.js      Klasör izleme, dosya kuyruğu, geçmiş aktarımı
lib/db.js           SQLite: olaylar, günlük/haftalık görünümler, bahçe
lib/garden.js       Ölçüler, sezonlar, ağaçlar, hasat
lib/stats.js        Günlük/haftalık seriler, CSV
lib/app-server.js   HTTP + SSE sunucu
public/themes.js    Sakura / Momiji / Fuji temaları
public/tree.js      Prosedürel bahçe (canvas)
public/app.js       Arayüz · public/stats.js İstatistikler · public/garden-view.js Bahçem
test/               node:test (25 test)
```

## Geliştirme

```bash
npm install        # yalnızca masaüstü paketleme için (Electron)
npm test           # 25 test
npm run app        # masaüstü uygulaması (kaynaktan)
npm run dist       # kurulum dosyası → dist/
npm run icons      # ikonları yeniden üret
```
