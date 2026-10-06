Yapay zekâ ajanlarım bir günde kaç token harcıyor, ben kendim kaç satır kod yazıyorum? Hiç görmüyordum.
Artık ikisi de masaüstümde birer ağaç olarak büyüyor. 🌸

Yeni yan projem Sakura Token Bahçesi: Claude Code, Claude, Codex ve VS Code'da çalıştıkça yavaşça büyüyen ağaçlardan oluşan bir masaüstü uygulaması.

Her aracın kendi ağacı var:
🌸 Claude Code → Sakura (kiraz çiçeği)
💮 Claude sohbetleri → Ume (erik çiçeği)
🍁 Codex → Momiji (Japon akçaağacı)
🪻 VS Code → Fuji (morsalkım)

Fuji projenin asıl motivasyon kısmı. Bu ağaç yalnızca elle yazdığım satırlarla büyüyor; yapıştırma ve AI tamamlamaları sayılmıyor. Ajanlarım ağaçlarını büyütürken Fuji'yi büyütmenin tek yolu kod yazmak. 😄

Bunu gerçekten sağlamak beklediğimden zor çıktı. İlk sürümde Copilot'un önerisini kabul etmek, ajanın yazdığı bir satırın sonuna iki harf eklemek ya da çoklu imleçle yazmak da sayılıyordu. Artık her satırın ne kadarının tuşla yazıldığı ayrı ayrı tutuluyor ve sayaç, gerçek bir VS Code içinde otomatik bir senaryoyla test ediliyor.

Harcanan tokenlar ağaca uçan küçük ışık taneleri olarak görünüyor. Ağaç tohumdan tam çiçeğe 12 evreden geçiyor. Hedefe ulaşınca onu "Bahçem"e dikiyorum, yerine yeni bir tohum başlıyor. Günler geçtikçe küçük bir bahçe oluşuyor.

Teknik tarafı:
→ API anahtarı ya da hook yok; ajanların zaten diske yazdığı kayıtları canlı okuyor
→ Hiçbir veri bilgisayardan çıkmıyor, sunucu yalnızca 127.0.0.1'i dinliyor
→ Geçmiş yerel bir SQLite veritabanında; nisandan bu yana 12.000'den fazla kayıt birkaç saniyede içe aktarıldı
→ Ağaçların hepsi kodla çiziliyor (Canvas), tek bir görsel dosyası yok
→ Electron masaüstü uygulaması ve widget, VS Code eklentisi, claude.ai yanıtlarını ölçen bir tarayıcı eklentisi
→ Node.js, 53 otomatik test ve gerçek VS Code'da uçtan uca bir senaryo

Son 30 günde ajanlarım 2,9 milyon çıktı tokenı üretmiş. Sayı olarak hiç dikkatimi çekmemişti; ağaç olarak görünce insan bir duruyor.

Ajanlar bu kadar çok yazarken, siz bugün elle kaç satır kod yazdınız? 🌳

🔗 github.com/cemrsz/sakura-token-garden

#YapayZeka #ClaudeCode #Codex #YanProje #YazılımGeliştirme
