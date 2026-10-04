# Sakura Token Bahçesi — Proje Raporu

**Tarih:** 4 Ekim 2026
**Durum:** Tamamlandı. Windows masaüstü uygulaması (.exe) + tarayıcı sürümü, çalışır durumda ve test edildi.

---

## 1. Özet

Yapay zekâ ajanların token harcadıkça yavaşça büyüyen bir ağaç bahçesi yapıldı. Hangi AI'ı kullandığına göre değişiyor:

- **Claude Code → 🌸 Sakura** (kiraz çiçeği): pembe tomurcuklar, çiçek bulutu, final *Hanami*.
- **Codex → 🍁 Momiji** (Japon akçaağacı): yapraklar sararır, turuncuya ve kızıla döner, final *Momijigari*.
- İkisini birden kullanırsan bahçede yan yana iki ağaç büyür; panel en son çalışan AI'ı gösterir.

Uygulama, ajanların diske zaten yazdığı transcript dosyalarını canlı okur. Hook, API anahtarı ya da ayar gerekmez.

**Kullanmak için:** `dist\SakuraTokenBahcesi-Kurulum-1.0.0.exe` dosyasını çalıştır (ya da kurulumsuz `dist\SakuraTokenBahcesi-1.0.0-portable.exe`).

## 2. Başlangıç durumu: Codex'ten ne kalmıştı?

`Sakura_Visualizer` klasörü **boştu**. Codex'in işleri `Documents\Codex\2026-09-19\` altında iki prototipti:

| Prototip | İçerik | Eksik |
|---|---|---|
| `b\sakura-progress` | 6 aşamalı Sakura konsept görseli + tıklamayla aşama değiştiren sayfa | Token bağlantısı yok; yayınlama bash/WSL olmadığı için yarım kaldı |
| `izgi-film-tarz-nda-interaktif-bir\dist\index.html` | "Bir Adım Büyüt" butonuyla 20 adımda büyüyen canvas ağaç | Token bağlantısı yok; büyüme manuel tıklamaya bağlı |

Asıl fikir — **ajan token harcadıkça kendiliğinden büyüyen ağaç** — hiç yapılmamıştı.

## 3. Ne yapıldı?

### 3.1 Token izleme

- Claude Code (`~/.claude/projects/**/*.jsonl`) ve Codex (`~/.codex/sessions/**/*.jsonl`) transcriptleri otomatik bulunur, canlı izlenir.
- Formatlarda iki tuzak tespit edildi ve çözüldü:
  - Claude Code aynı yanıtın `usage` bilgisini **her içerik bloğu için tekrar** yazıyor; tekilleştirilmeseydi sayım ~2 kat şişerdi → `message.id + requestId` ile global tekilleştirme.
  - Codex **kümülatif** toplam yazıyor ve tekrarlayabiliyor → ardışık farklar alınıyor; devam ettirilen (resume) oturumun devraldığı toplam sayılmıyor.
- Dosyalar bayt konumundan okunur, yarım satırlar beklenir; yeni token ~1–2 sn içinde ekrana yansır. Açılışta son 7 gün ~0,75 sn'de taranır.

### 3.2 AI'a göre değişen ağaçlar

- Ağaçlar tamamen prosedürel (görsel dosya yok). Codex'in konsept illüstrasyonundaki çizgi film estetiği temel alındı: kalın kıvrık gövde, konturlu çiçek kümeleri, çimenli toprak höyüğü.
- Her türün kendi tohumu (gövde/dal şekli), renk paleti, yaprak/çiçek şekli (Sakura'da beş çentikli taç yaprak, Momiji'de beş loblu akçaağaç yaprağı), düşen yaprakları ve 12 evre adı var (`public/themes.js`).
- Büyüme sürekli: `ilerleme = token / hedef`. Tohum → çatlak → filiz → fidan → dallar → yapraklanma → tomurcuk / sararma → çiçek / kızıllık → final.
- Canlılık: rüzgârda sallanan dallar, harcanan tokenların ağaca uçan ışık taneleri, evre bildirimleri, finalde yaprak yağmuru, erken evrelerde tohuma yakınlaşan kamera.
- **Görünüm ayarı:** "Her AI'a ayrı ağaç" (varsayılan; o sezon token harcayan her AI'ın ağacı dikilir) veya "Tek ağaç" (türünü en çok kullanılan AI belirler).

### 3.3 Masaüstü uygulaması (Electron)

| Özellik | Açıklama |
|---|---|
| Ana pencere | Bahçe, evreler, istatistikler, ayarlar. Kapatınca tepsiye küçülür. |
| Widget | Çerçevesiz, **her zaman üstte**, sürüklenebilir/boyutlanabilir; konumu hatırlanır. |
| Sistem tepsisi | Bahçeyi aç · Widget · Her zaman üstte · **Windows açılışında başlat** · Çıkış; ipucunda ağaç yüzdeleri. |
| Görev çubuğu | Uygulama simgesinde ilerleme çubuğu; pencere başlığında tür ve yüzde. |
| Bildirim | Ağaç finale ulaşınca Windows bildirimi. |
| Tek kopya | İkinci açılış mevcut pencereyi öne getirir. |
| Güvenlik | Sayfa yalnızca yerel sunucuyu açar, Node erişimi yok (contextIsolation + sandbox); dış linkler tarayıcıda açılır. |
| Paket | NSIS kurulum dosyası (Başlat menüsü + masaüstü kısayolu) ve taşınabilir tek exe. Uygulama ikonu Sakura + Momiji. |

### 3.4 Ayarlar

Sezon (günlük / manuel + "Yeni tohum ek"), hedef (300K–40M ya da özel), ölçü (Ağırlıklı / Yeni tokenlar / Sadece çıktı / Tümü), kaynaklar (Claude Code ve Codex ayrı ayrı), görünüm (ayrı / tek ağaç), bu sezonun dökümü ve son oturumlar.

### 3.5 Dosyalar

| Dosya | Satır | Görev |
|---|---:|---|
| `public/tree.js` | 1355 | Prosedürel bahçe: bitkiler, tema sprite'ları, parçacıklar, yerleşim |
| `public/app.js` | 534 | Arayüz, SSE, ayarlar, widget / PiP, masaüstü köprüsü |
| `public/themes.js` | 106 | AI → ağaç türü temaları |
| `desktop/main.js` | 347 | Electron: pencereler, tepsi, bildirim, görev çubuğu |
| `lib/garden.js` | 298 | Ölçüler, sezonlar, AI başına ağaç kararı |
| `lib/app-server.js` | 236 | HTTP/SSE sunucu (iki sürüm ortak) |
| `lib/tracker.js` · `lib/parsers.js` | 368 | Dosya takibi, Claude/Codex çözümleyiciler |
| `test/*.test.js` | ~260 | 16 test |

## 4. Doğrulama

| Kontrol | Sonuç |
|---|---|
| `npm test` — parser'lar, sezon mantığı, AI başına ağaç kararı, uçtan uca dosya takibi | ✅ 16/16 |
| Gerçek verilerle canlı büyüme | ✅ Bu oturumun Claude Code kullanımı canlı okundu; bugünkü Sakura gözümün önünde büyüdü (5M hedefte şu an %96, "Çiçeklenme"), evre bildirimleri kendiliğinden çıktı |
| Geçmiş günlerin doğruluğu | ✅ Bağımsız bir tarama betiğiyle birebir tuttu (ör. 1 Ekim: 3,76M) |
| Sakura ve Momiji'nin tüm evreleri, iki ağaçlı bahçe | ✅ Ekran görüntüleriyle tek tek incelendi |
| Masaüstü, mobil, widget yerleşimleri | ✅ |
| Electron uygulaması (kaynaktan ve **paketlenmiş exe**) | ✅ Öz-test modu iki pencerenin ekran görüntüsünü aldı: ağaç, tepsi ipucu ("🌸 Sakura %96"), pencere başlığı ve widget'ın her zaman üstte olduğu doğrulandı |
| Demo modu, ayar değiştirme, yeni tohum, SSE | ✅ |
| Güvenlik: form POST → 415, yabancı Origin/Host → 403, dizin dışı yol → 404 | ✅ |

Yol boyunca bulunup düzeltilen bir Electron tuhaflığı: Windows'ta widget'ın "her zaman üstte" bayrağı, pencere ekrana yerleşmeden verilince sessizce uygulanmıyordu (küçük deneme betikleriyle doğrulandı); artık pencere göründükten sonra kapat-aç yapılarak uygulanıyor.

**Doğrulayamadıklarım:**
- Kurulum sihirbazını (`Kurulum.exe`) baştan sona tıklayarak kurmadım; kurulum içindeki uygulamanın aynısı olan `win-unpacked` sürümünü test ettim.
- "Windows açılışında başlat" seçeneği yalnızca kurulu (paketlenmiş) uygulamada etkin; yeniden başlatma gerektirdiği için denemedim.
- Tarayıcı sürümündeki Picture‑in‑Picture penceresi, test ettiğim uygulama içi tarayıcıda açılamadı (yedek yol çalıştı). Masaüstü uygulamasında bunun yerine kendi widget'ı kullanılıyor.
- Exe dosyaları kod imzalı değil; Windows SmartScreen ilk açılışta uyarı gösterebilir ("Ek bilgi → Yine de çalıştır").

## 5. Verilen kararlar

- **Codex → Momiji:** Kullanıcı tür belirtmediği için Sakura ile belirgin şekilde ayrışan, aynı Japon bahçesi temasında kalan bir tür seçildi (ilkbahar ↔ sonbahar, Hanami ↔ Momijigari). `themes.js`'te tek satırla değiştirilebilir.
- **Ağaç ancak o AI token harcayınca dikilir:** İlk denemede son 7 günde kullanılan her AI'a yer açılıyordu; boş bir tohum höyüğü aktif ağacı yarı boyuta düşürdüğü için değiştirildi. Codex'i çalıştırdığın an yanına Momiji dikilir.
- **Varsayılan hedef 5M ağırlıklı token (ağaç başına):** Geçmiş verilerinde yoğun bir gün 3–9M. 2M ile büyük bağlamlı tek bir Claude Code oturumu ağacı ~1,5 saatte dolduruyordu.
- **Electron:** Gerçek pencere, tepsi, her zaman üstte widget ve açılışta başlatma için en olgun seçenek. Tarayıcı sürümü bağımlılıksız kalmaya devam ediyor.

## 6. Nasıl kullanılır?

1. `dist\SakuraTokenBahcesi-Kurulum-1.0.0.exe` → kur → Başlat menüsünden **Sakura Token Bahçesi**.
2. Claude Code veya Codex ile çalışmaya devam et — ilgili ağaç kendiliğinden büyür.
3. Ana penceredeki ▣ düğmesiyle widget'ı aç; köşede her zaman üstte durur. Tepsideki 🌸 menüsünden "Windows açılışında başlat"ı işaretleyebilirsin.

Kaynak koddan: `npm install` → `npm run app`. Kurulum dosyasını yeniden üretmek: `npm run dist`.

## 7. Bilinen sınırlamalar ve öneriler

- Yalnızca Claude Code ve Codex destekleniyor. Yeni bir AI için `lib/parsers.js`'e çözümleyici, `lib/tracker.js`'e klasör, `themes.js`'e tema eklemek yeterli (ör. Gemini CLI → mor Jakaranda).
- Transcript formatları resmî bir API değil; Claude Code veya Codex formatı değişirse çözümleyici güncellenmeli (testler bunu hemen yakalar).
- Otomatik güncelleme yok; yeni sürüm için `npm run dist` ile yeniden paketlenmeli.
- Kod imzalama sertifikası eklenirse SmartScreen uyarısı kalkar.

---

## 8. Güncelleme — veritabanı, VS Code ağacı ve Bahçem

### 8.1 Günlük / haftalık kayıt (bilgisayardaki veritabanı)
- Node ve Electron'un **yerleşik SQLite**'ı kullanıldı (ek paket / derleme yok). Dosya: `%APPDATA%\sakura-token-garden\data\sakura.db`.
- Her model çağrısı tekil bir kimlikle saklanıyor; transcriptler tekrar okunsa da hiçbir şey iki kez sayılmıyor.
- İlk açılışta bütün geçmiş içe aktarılıyor: bu bilgisayarda **274 dosya / 12.049 kayıt ~4 saniyede** aktarıldı; geçmiş Codex için 25 Nisan, Claude Code için 20 Haziran 2026'ya uzanıyor. Uygulama kapalı kaldığı günler bir sonraki açılışta tamamlanıyor.
- **İstatistikler** ekranı: bugün / dün / bu hafta / geçen hafta / son 30 gün; 30 günlük ve 12 haftalık yığılmış çubuk grafik; token ↔ kod satırı; grafik ↔ tablo; CSV indirme. Değerler daha önce bağımsız sayılanlarla birebir tuttu (ör. 1 Ekim 3,28M + 0,49M).
- Grafik renkleri renk körlüğü dahil doğrulandı (Claude #cf4f8c, Codex #e39a2f, VS Code #6a5fd1).

### 8.2 VS Code → 🪻 Fuji (elle yazılan satırlar)
- `vscode-extension/` içinde bir VS Code eklentisi yazıldı, paketlendi (`.vsix`) ve VS Code'una **kuruldu** (`cemrsz.sakura-code-garden`).
- Bir satır yalnızca o satırda gerçekten tuşa basılarak yazılıp Enter ile bitirildiyse sayılıyor; yapıştırma, AI tamamlama, snippet, biçimlendirme, geri al ve boş satırlar sayılmıyor. Sahte VS Code ortamında test edildi: 2 elle yazılmış satır sayıldı, diğer senaryoların hiçbiri sayılmadı.
- Hedefler 50 / 100 / 250 / 1000 / 5000 satır (varsayılan 250). Fuji'nin çiçekleri dala göre değil yerçekimiyle aşağı sarkan salkımlar.

### 8.3 🌳 Bahçem
- Ağaç %100'e ulaşınca panelde **“Bahçeye dik”** düğmesi çıkıyor; dikilen ağaç bahçeye geçiyor, aktif ağaç fazlasını devralarak yeniden başlıyor (API ile doğrulandı: %224 → %124 → %24).
- Dikilmeyen tamamlanmış ağaçlar sezon sonunda kendiliğinden dikiliyor (gerçek veriyle doğrulandı: dünkü 2,09M token, 1M hedefle 2 Sakura olarak dikildi). Bahçe özelliğinden önceki tamamlanmış sezonların da bir kerelik bahçeye taşınıyor.
- Bahçe ekranı perspektifli bir çayır; her ağaç kendi tohumuyla farklı şekilde büyüyor; liste görünümü var.

### 8.4 Doğrulama
| Kontrol | Sonuç |
|---|---|
| `npm test` | ✅ 25/25 (veritabanı, istatistik, VS Code eklentisi, hasat, otomatik dikim, geçmiş aktarımı dahil) |
| Yeni ekranların görsel kontrolü (Fuji, üç ağaçlı bahçe, İstatistikler, Bahçem) | ✅ |
| Uç noktalar: `/api/stats`, `/api/stats.csv`, `/api/garden`, `/api/garden/plant` | ✅ |

**Doğrulayamadığım:** VS Code'da gerçekten klavyeyle yazarak uçtan uca sayımı (VS Code'a yazı yazma iznim yok). Mantık sahte ortamda, okuma tarafı gerçek dosyalarla test edildi; VS Code penceresini yeniden yükledikten sonra durum çubuğunda `🪻` sayacını görmelisin.

---

## 9. Güncelleme (1.2.0) — düz Claude da sayılıyor: 💮 Ume

**İstek:** Görselleştirici yalnızca Claude Code'la değil, düz Claude kullanınca da büyüsün.

### 9.1 Sorun: sohbetler diske token yazmıyor
Claude Code her yanıtın `usage` bilgisini `~/.claude/projects` altına yazıyor; claude.ai ve Claude masaüstü
uygulamasının sohbet sekmesi ise bilgisayarda okunabilir bir token kaydı bırakmıyor. Bu yüzden iki yol açıldı:

| Kaynak | Nasıl okunuyor | Doğruluk |
|---|---|---|
| **claude.ai** (Chrome / Edge / Brave) | Yeni tarayıcı eklentisi (`browser-extension/`) yanıt akışını ölçüp yerel uygulamaya yolluyor | Tahmini (~3,5 karakter = 1 token) |
| **Cowork** (Claude masaüstü) | `%APPDATA%\Claude\local-agent-mode-sessions\…\.claude\projects` altındaki transcriptler, Claude Code çözümleyicisiyle | Gerçek `usage` |

İkisi de yeni **Claude** kaynağını ve kendi ağacını büyütüyor: **💮 Ume** (Japon erik çiçeği). Kışın sonunda,
yapraklardan önce açan çiçek; final *Umemi* (erik çiçeği seyri, Hanami'nin eşi). Yuvarlak, çentiksiz taç yapraklar,
uzun ercikler, dokuzuncu evrede dallarda yuvarlak kırmızı tomurcuklar, koyu ve eğri bir gövde.

### 9.2 Tarayıcı eklentisi nasıl ölçüyor?
- Sayfanın `fetch` çağrısını sarıyor ve yalnızca iki yanıtın **kopyasını** okuyor: sohbet geçmişi (bağlam uzunluğu)
  ve completion akışı (SSE). Sayfanın aldığı yanıt değişmiyor; testte sayfanın akışı birebir aynı geldi.
- Yeni mesaj + ekler + stil → **girdi**; görünen daldaki geçmiş → **önbellekten okuma** (claude.ai bağlamı önbellekten
  okutuyor, ağırlıklı ölçüde %10); yanıt + düşünme + araç çağrısı → **çıktı**; web araması sonuçları → **girdi**.
  Akışta gerçek `usage` gelirse tahmin yerine o kullanılıyor.
- Mesaj içeriği hiçbir yere gitmiyor: uygulamaya yalnızca sayılar, model adı ve sohbet başlığı gidiyor.
- Uygulama kapalıysa ölçümler eklentide kuyrukta bekliyor (en fazla 2000), dakikada bir yeniden deneniyor.
- Sunucudaki `/api/ingest` yalnızca eklenti kökeninden gelen ölçümü kabul ediyor; eklenti ayar değiştiremiyor,
  başka siteler hiçbir şey gönderemiyor (testle doğrulandı: 403 / 415).
- Açılır pencere: bağlantı durumu, Ume ağacının bugünkü yüzdesi, bu tarayıcıda bugün ölçülen yanıtlar, ölçüm anahtarı.

### 9.3 Yol boyunca bulunan hata
Sunucu istek gövdesini parça parça birleştirirken, iki TCP parçasına bölünen çok baytlı bir harf (ğ, ş, ü…)
bozuluyordu ("ğ" → "��"). Eski sürümde ayar istekleri küçük olduğu için görünmüyordu; eklentinin büyük paketlerinde
sohbet başlıklarını bozacaktı. Düzeltildi ve bunu yakalayan bir test eklendi (düzeltme olmadan kalıyor, düzeltmeyle geçiyor).

### 9.4 Doğrulama
| Kontrol | Sonuç |
|---|---|
| `npm test` | ✅ 38/38 (claude.ai çözümleyicisi, Cowork okuyucusu, `/api/ingest`, sahte claude.ai sayfasında ölçer, arka plan kuyruğu → gerçek sunucu → Ume, UTF-8) |
| Ume'nin evreleri, dört ağaçlı bahçe, İstatistikler'de üçüncü seri (mavi), Bahçem | ✅ Ekran görüntüleriyle |
| Gerçek sunucuya eklenti gibi ölçüm gönderme (geçici veri klasörüyle) | ✅ Ume büyüdü; ayarlarda "claude.ai: 1 günlük kayıt · Cowork: 1 oturum" |
| Eklenti açılır penceresi (sahte tarayıcı API'siyle) | ✅ |
| Masaüstü 1.2.0 paketi | `dist/1.2.0/` (aşağıya bakın) |

**Doğrulayamadıklarım:**
- **Canlı claude.ai trafiği.** claude.ai oturumuna erişimim yok; ölçer, claude.ai'nin kullandığı Anthropic akış biçimine
  (ve eski `completion` biçimine) göre yazıldı ve sahte bir sayfada test edildi. Eklentiyi kurup bir mesaj gönderdikten
  sonra 💮 simgesinde "1 yanıt" görmelisin; görmezsen claude.ai akış biçimini değiştirmiş olabilir.
- **Gerçek Cowork kayıtların.** Bu kayıtları açıp incelemem izinle engellendi; okuyucu yalnızca sahte Cowork klasörüyle
  test edildi. Biçim Claude Code'unkiyle aynı olduğu için aynı çözümleyici kullanılıyor; uygulama bu klasörü senin
  bilgisayarında kendisi okuyacak.
- **Claude masaüstü sohbet sekmesi** desteklenmiyor: token kaydı yazmıyor, eklenti alamıyor; uygulamanın kendi
  önbelleğini okumak hem kırılgan hem de izin verilmeyen bir yoldu. Sayılmasını istediğin sohbetleri tarayıcıda yap.

### 9.5 Verilen kararlar
- **Ayrı ağaç (Ume):** Claude sohbetleri Claude Code'un Sakura'sına karıştırılmadı; istatistiklerde ve Bahçem'de ayrı
  görünüyor. İstersen ayarlardaki *Tek ağaç* görünümü hepsini birleştirir, kaynak anahtarıyla Claude kapatılabilir.
- **Grafik rengi mavi (#2a7fc1):** Ume pembe-kırmızı ama grafikte Claude Code'un pembesi ve Codex'in turuncusu yanında
  renk körlüğünde de ayrışsın diye mavi seçildi.
- **Tahmin oranı 3,5 karakter/token:** İngilizcede ~4, Türkçe ve kodda ~3; ikisinin arası. `lib/parsers.js`'te tek sabit.

### 9.6 Kullanmak için
1. Açık olan 1.1.0 uygulamasından tepsideki 🌸 menüsüyle çık, `dist\1.2.0\SakuraTokenBahcesi-Kurulum-1.2.0.exe` ile kur
   (ya da `npm run app`).
2. Chrome/Edge'de `chrome://extensions` → Geliştirici modu → **Paketlenmemiş öğe yükle** → `browser-extension`.
3. claude.ai sekmesini yenile, sohbet et — bahçede Sakura'nın yanında Ume filizlenir.
