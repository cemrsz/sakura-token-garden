# 🪻 Sakura Kod Bahçesi (VS Code)

Elle yazdığın kod satırlarını sayar ve [Sakura Token Bahçesi](https://github.com/cemrsz/sakura-token-garden)'nde
**Fuji** (morsalkım) ağacını büyütür. Hedefler: 50 · 100 · 250 · 1000 · 5000 satır.

## Ne sayılır?

Bir satır, **o satırda gerçekten tuşa basarak yazdıysan** ve Enter ile bitirdiysen sayılır.

Sayılmayanlar: yapıştırma, Copilot / AI tamamlamaları ve düzenlemeleri, snippet'ler, otomatik biçimlendirme,
geri al / yinele, boş satırlar, çıktı panelleri ve commit mesajı kutusu.

## Nereye yazar?

Sayılar yalnızca bilgisayarındaki bir klasöre yazılır; internete hiçbir şey gönderilmez:

- Windows: `%APPDATA%\sakura-token-garden\vscode\`
- macOS: `~/Library/Application Support/sakura-token-garden/vscode/`
- Linux: `~/.config/sakura-token-garden/vscode/`

Sakura uygulaması kapalıyken de kayıt tutulur; uygulama açılınca okunur ve günlük / haftalık veritabanına eklenir.

## Komutlar

- **Sakura: Bahçeyi aç** — durum çubuğundaki 🪻 sayaca tıklamakla aynı.
- **Sakura: Satır saymayı aç / kapat**

Ayarlar: `sakuraGarden.enabled`, `sakuraGarden.minTypedChars` (varsayılan 2).
