// Her AI kendi ağaç türünü büyütür. Yeni bir AI eklemek için buraya bir tema,
// lib/parsers.js'e de bir çözümleyici eklemek yeterli.
//
// Evre eşikleri tree.js'deki büyüme evreleriyle hizalıdır:
// tohum → çatlak → filiz → fidan → dallar → yaprak → tomurcuk/renk dönümü → çiçek/kızıl yaprak → final.

const STAGE_AT = [0, 0.02, 0.05, 0.12, 0.22, 0.33, 0.42, 0.52, 0.6, 0.7, 0.84, 1];

const withThresholds = (stages) => stages.map(([name, msg], index) => ({ at: STAGE_AT[index], name, msg }));

const COMMON_EARLY = [
  ['Uykudaki tohum', 'Toprağın altında sessizce ilk tokenleri bekliyor.'],
  ['İlk kıpırtı', 'Toprak çatladı; ajanın ilk düşünceleri kök salıyor.'],
  ['Minik filiz', 'İki yaprakçık ışığa doğru açıldı.'],
  ['İnce fidan', 'Gövde her istekle biraz daha yükseliyor.'],
  ['İlk dallar', 'Gövdeden ilk yan dallar ayrılıyor.'],
  ['Genç ağaç', 'Dallar çatallanıyor, taç şekilleniyor.'],
];

export const THEMES = {
  claude: {
    id: 'claude',
    ai: 'Claude Code',
    species: 'Sakura',
    speciesDetail: 'Japon kiraz çiçeği',
    finale: 'Hanami',
    emoji: '🌸',
    seed: 20260919,
    spread: 1,
    accent: '#e0668f',
    accentDeep: '#c44c76',
    glow: [255, 214, 228],
    mote: ['rgba(255,214,120,.95)', 'rgba(255,150,185,.35)'],
    flower: {
      shape: 'sakura',
      palettes: [
        ['#fffafc', '#ffd0de', '#f7a6c0', '#d9718f'],
        ['#fff4f7', '#ffbfd2', '#f190b0', '#cf5f84'],
        ['#ffffff', '#ffe0ea', '#fbb9cd', '#df84a2'],
      ],
      center: '#f6cf63',
      stamen: '#e07f6a',
      anther: '#f2b544',
    },
    bud: { shape: 'sakura', light: '#ffe3ec', mid: '#f59bb9', dark: '#e06d95', line: '#c4507a' },
    leaf: { shape: 'oval', palettes: [['#9fd062', '#5a9640'], ['#b6dc77', '#6fa648']], line: '#3d6b2c' },
    canopy: { outline: '#e294ae', fill: '#f8c4d5', light: '#fbd6e2' },
    petal: { shape: 'sakura', light: '#fff3f7', dark: '#f6a2bf', line: '#db7896' },
    // [kontur, dolgu, gölge, ışık]
    bark: { young: ['#3f5a2a', '#7d9a4a', '#68843c', '#9cb860'], mature: ['#4a2c1e', '#8e5c3e', '#6f4430', '#ad7853'] },
    stages: withThresholds([
      ...COMMON_EARLY,
      ['Yapraklanma', 'Taze yeşil yapraklar dal uçlarını sarıyor.'],
      ['Gür taç', 'Yapraklar sıklaştı; ağaç gölge vermeye başladı.'],
      ['Pembe tomurcuklar', 'Dal uçlarında minik tomurcuklar belirdi.'],
      ['İlk çiçekler', 'İlk sakura çiçekleri usulca açıyor.'],
      ['Çiçeklenme', 'Pembe çiçekler dalları sırayla kaplıyor.'],
      ['Hanami', 'Tam çiçeklenme! Bu sezonun hedefi tamamlandı.'],
    ]),
  },

  codex: {
    id: 'codex',
    ai: 'Codex',
    species: 'Momiji',
    speciesDetail: 'Japon akçaağacı',
    finale: 'Momijigari',
    emoji: '🍁',
    seed: 8128,
    spread: 1.12,
    accent: '#d9622b',
    accentDeep: '#b0461b',
    glow: [255, 208, 160],
    mote: ['rgba(255,226,140,.95)', 'rgba(255,140,80,.35)'],
    flower: {
      shape: 'maple',
      palettes: [
        ['#ffe7a0', '#f9b04a', '#ea6f2d', '#a8441f'],
        ['#ffd08a', '#f4893c', '#d9472b', '#93301d'],
        ['#ffb48a', '#ec5e3f', '#c22c30', '#7f1d22'],
      ],
    },
    bud: { shape: 'maple', light: '#f7f2a6', mid: '#dfd65c', dark: '#c0a73a', line: '#7f6d22' },
    leaf: { shape: 'maple', palettes: [['#a6d66a', '#5a9a40'], ['#c4e384', '#72aa4b']], line: '#3d6b2c' },
    canopy: { outline: '#c2512f', fill: '#f29a55', light: '#f7b676' },
    petal: { shape: 'maple', light: '#ffc47a', dark: '#e0532f', line: '#9c3a1c' },
    bark: { young: ['#3f5a2a', '#7d9a4a', '#68843c', '#9cb860'], mature: ['#3b2a22', '#7a5b4a', '#5c4336', '#9a7a69'] },
    stages: withThresholds([
      ...COMMON_EARLY,
      ['Yapraklanma', 'Beş parmaklı akçaağaç yaprakları açılıyor.'],
      ['Gür yaz tacı', 'Taç yemyeşil; ağaç gölge vermeye başladı.'],
      ['İlk sararma', 'Yaprak uçları altın sarısına dönüyor.'],
      ['Turuncu dallar', 'Turuncu ve kızıl yapraklar dalları sarıyor.'],
      ['Kızıl taç', 'Ağaç alev gibi kızıla döndü.'],
      ['Momijigari', 'Tam sonbahar! Bu sezonun hedefi tamamlandı.'],
    ]),
  },
};

export const themeOf = (id) => THEMES[id] || THEMES.claude;

export function stageIndex(theme, progress) {
  let index = 0;
  for (let i = 0; i < theme.stages.length; i += 1) if (progress >= theme.stages[i].at) index = i;
  return index;
}
