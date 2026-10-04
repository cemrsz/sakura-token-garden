# 💮 Sakura Sohbet Bahçesi — tarayıcı eklentisi

claude.ai'de sohbet ettikçe Sakura Token Bahçesi'ndeki **Ume** (Japon erik çiçeği) ağacını büyütür.
Claude Code'un aksine claude.ai sohbetleri bilgisayara token kaydı yazmaz; bu eklenti sayfadaki
yanıt akışını ölçerek aradaki boşluğu doldurur.

## Kurulum (Chrome, Edge, Brave)

1. Tarayıcıda `chrome://extensions` (Edge: `edge://extensions`) sayfasını aç.
2. Sağ üstten **Geliştirici modu**nu aç.
3. **Paketlenmemiş öğe yükle** → bu `browser-extension` klasörünü seç.
4. Açık claude.ai sekmelerini yenile.

Sakura uygulaması (masaüstü ya da `npm start`) açık olmalı. Kapalıyken ölçülen yanıtlar eklentide
bekler ve uygulama açılınca aktarılır. Araç çubuğundaki 💮 simgesi bağlantıyı, Ume ağacının bugünkü
durumunu ve ölçüm anahtarını gösterir.

## Nasıl ölçer?

| Ne | Nereden | Ağaçta |
| --- | --- | --- |
| Yeni mesaj, ekler, stil yönergesi | completion isteğinin gövdesi | girdi |
| Sohbet geçmişi (görünen dal) | sohbet açılırken gelen geçmiş yanıtı, sonra her turda eklenen soru + yanıt | önbellekten okuma |
| Yanıt metni, düşünme, araç çağrısı | yanıt akışı (SSE) | çıktı |
| Web araması gibi sunucu araçlarının sonucu | yanıt akışı | girdi |

- Akışta gerçek `usage` alanı varsa tahmin yerine o kullanılır; yoksa ~3,5 karakter = 1 token sayılır.
- claude.ai'nin gizli sistem yönergesi, görseller ve PDF sayfaları görünmediği için sayılamaz;
  bu yüzden sonuç gerçek kullanımın **alt sınırına yakın bir tahmindir**.
- Claude masaüstü uygulamasının sohbet sekmesine eklenti kurulamaz. Masaüstündeki **Cowork**
  oturumları ise kendi kayıtlarından gerçek değerlerle okunur; eklenti gerekmez.

## Gizlilik

- Mesaj içeriği hiçbir yere gönderilmez. Uygulamaya giden tek şey: sohbet kimliği, başlığı, model
  adı ve karakter sayıları.
- Veri yalnızca `http://127.0.0.1:4870–4879` adresindeki yerel Sakura uygulamasına gider; uygulama
  bu adresten yalnızca ölçüm kabul eder, eklentinin ayarları değiştirmesine izin vermez.
- İzinler: `storage` (kuyruk), `alarms` (yeniden deneme), `127.0.0.1` (yerel uygulama), claude.ai
  sayfası (ölçüm).
