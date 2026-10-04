// Sakura Sohbet Bahçesi — köprü (eklentinin yalıtılmış dünyası).
// Sayfa betiğinin (meter.js) window.postMessage ile bıraktığı ölçümleri eklentinin arka planına
// iletir. Yalnızca aynı sekmeden ve aynı kökenden gelen, beklenen kanaldaki iletiler geçer.
(() => {
  'use strict';

  const CHANNEL = 'sakura-chat-meter';

  window.addEventListener('message', (message) => {
    if (message.source !== window || message.origin !== window.location.origin) return;
    const data = message.data;
    if (!data || data.channel !== CHANNEL || !data.event || typeof data.event !== 'object') return;
    try {
      chrome.runtime.sendMessage({ type: 'chat-event', event: data.event }).catch(() => {});
    } catch {
      // Eklenti güncellendi ya da kapatıldı; sayfa yenilenince köprü yeniden bağlanır.
    }
  });
})();
