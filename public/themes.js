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
    unit: 'tokens',
    accent: '#e0668f',
    accentDeep: '#c44c76',
    chart: '#cf4f8c',
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
    unit: 'tokens',
    accent: '#d9622b',
    accentDeep: '#b0461b',
    chart: '#e39a2f',
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

  vscode: {
    id: 'vscode',
    ai: 'VS Code',
    species: 'Fuji',
    speciesDetail: 'Japon morsalkımı',
    finale: 'Fujimatsuri',
    emoji: '🪻',
    seed: 31415,
    spread: 1.06,
    unit: 'lines',
    accent: '#6a5fd1',
    accentDeep: '#5246b5',
    chart: '#6a5fd1',
    glow: [222, 212, 255],
    mote: ['rgba(236,226,255,.95)', 'rgba(150,120,235,.35)'],
    flower: {
      shape: 'wisteria',
      hang: true,
      palettes: [
        ['#f1eaff', '#c9b6fb', '#8e72e0', '#5a3fa8'],
        ['#ece6ff', '#b9a5f6', '#7b62d6', '#4d379a'],
        ['#f6f0ff', '#d8c9fd', '#a08af0', '#6650b8'],
      ],
    },
    bud: { shape: 'wisteria', light: '#eef3d9', mid: '#c9d6a2', dark: '#a3a6d8', line: '#5d6b3a' },
    leaf: { shape: 'oval', palettes: [['#a9d470', '#5c9844'], ['#c2e08a', '#76ab50']], line: '#3d6b2c' },
    canopy: { outline: '#8d76d6', fill: '#cdbcf5', light: '#ddd0fa' },
    petal: { shape: 'sakura', light: '#f3eeff', dark: '#b39cf3', line: '#7c64cf' },
    bark: { young: ['#3f5a2a', '#7d9a4a', '#68843c', '#9cb860'], mature: ['#3a2c26', '#7b6457', '#5d4a40', '#9a8274'] },
    stages: withThresholds([
      ['Uykudaki tohum', 'Toprağın altında ilk elle yazılan satırı bekliyor.'],
      ['İlk kıpırtı', 'İlk satırlar toprağa düştü.'],
      ['Minik filiz', 'Klavyeden gelen her satır filizi besliyor.'],
      ['İnce fidan', 'Gövde satır satır yükseliyor.'],
      ['İlk dallar', 'Kodun ilk dalları ayrılıyor.'],
      ['Genç ağaç', 'Dallar çatallanıyor, taç şekilleniyor.'],
      ['Yapraklanma', 'Taze yeşil yapraklar açılıyor.'],
      ['Gür taç', 'Yapraklar sıklaştı; ağaç gölge vermeye başladı.'],
      ['Mor tomurcuklar', 'Dallardan minik salkım tomurcukları sarktı.'],
      ['İlk salkımlar', 'İlk morsalkımlar açtı.'],
      ['Salkım yağmuru', 'Mor salkımlar dalları kaplıyor.'],
      ['Fujimatsuri', 'Tam çiçeklenme! Bu sezonun kod hedefi tamamlandı.'],
    ]),
  },
};

export const themeOf = (id) => THEMES[id] || THEMES.claude;

export function stageIndex(theme, progress) {
  let index = 0;
  for (let i = 0; i < theme.stages.length; i += 1) if (progress >= theme.stages[i].at) index = i;
  return index;
}
