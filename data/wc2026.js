// Dados oficiais da Copa do Mundo FIFA 2026 (sorteio realizado em 05/12/2025).
// 48 seleções, 12 grupos (A–L) de 4 times.
// Datas das partidas são aproximadas e podem ser ajustadas pelo admin do bolão.

export const GROUPS = {
  A: ['México', 'África do Sul', 'Coreia do Sul', 'Tchéquia'],
  B: ['Canadá', 'Bósnia e Herzegovina', 'Catar', 'Suíça'],
  C: ['Brasil', 'Marrocos', 'Haiti', 'Escócia'],
  D: ['Estados Unidos', 'Paraguai', 'Austrália', 'Turquia'],
  E: ['Alemanha', 'Curaçao', 'Costa do Marfim', 'Equador'],
  F: ['Holanda', 'Japão', 'Suécia', 'Tunísia'],
  G: ['Bélgica', 'Egito', 'Irã', 'Nova Zelândia'],
  H: ['Espanha', 'Cabo Verde', 'Arábia Saudita', 'Uruguai'],
  I: ['França', 'Senegal', 'Iraque', 'Noruega'],
  J: ['Argentina', 'Argélia', 'Áustria', 'Jordânia'],
  K: ['Portugal', 'Congo (RDC)', 'Uzbequistão', 'Colômbia'],
  L: ['Inglaterra', 'Croácia', 'Gana', 'Panamá'],
};

// Bandeiras (emoji) para deixar a interface mais bonita.
export const FLAGS = {
  'México': '🇲🇽', 'África do Sul': '🇿🇦', 'Coreia do Sul': '🇰🇷', 'Tchéquia': '🇨🇿',
  'Canadá': '🇨🇦', 'Bósnia e Herzegovina': '🇧🇦', 'Catar': '🇶🇦', 'Suíça': '🇨🇭',
  'Brasil': '🇧🇷', 'Marrocos': '🇲🇦', 'Haiti': '🇭🇹', 'Escócia': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'Estados Unidos': '🇺🇸', 'Paraguai': '🇵🇾', 'Austrália': '🇦🇺', 'Turquia': '🇹🇷',
  'Alemanha': '🇩🇪', 'Curaçao': '🇨🇼', 'Costa do Marfim': '🇨🇮', 'Equador': '🇪🇨',
  'Holanda': '🇳🇱', 'Japão': '🇯🇵', 'Suécia': '🇸🇪', 'Tunísia': '🇹🇳',
  'Bélgica': '🇧🇪', 'Egito': '🇪🇬', 'Irã': '🇮🇷', 'Nova Zelândia': '🇳🇿',
  'Espanha': '🇪🇸', 'Cabo Verde': '🇨🇻', 'Arábia Saudita': '🇸🇦', 'Uruguai': '🇺🇾',
  'França': '🇫🇷', 'Senegal': '🇸🇳', 'Iraque': '🇮🇶', 'Noruega': '🇳🇴',
  'Argentina': '🇦🇷', 'Argélia': '🇩🇿', 'Áustria': '🇦🇹', 'Jordânia': '🇯🇴',
  'Portugal': '🇵🇹', 'Congo (RDC)': '🇨🇩', 'Uzbequistão': '🇺🇿', 'Colômbia': '🇨🇴',
  'Inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Croácia': '🇭🇷', 'Gana': '🇬🇭', 'Panamá': '🇵🇦',
};

// Código ISO (flagcdn) por seleção — usados para renderizar a bandeira como imagem
// (emoji de bandeira não funciona no Windows). Sub-regiões usam o formato do flagcdn.
export const CODES = {
  'México': 'mx', 'África do Sul': 'za', 'Coreia do Sul': 'kr', 'Tchéquia': 'cz',
  'Canadá': 'ca', 'Bósnia e Herzegovina': 'ba', 'Catar': 'qa', 'Suíça': 'ch',
  'Brasil': 'br', 'Marrocos': 'ma', 'Haiti': 'ht', 'Escócia': 'gb-sct',
  'Estados Unidos': 'us', 'Paraguai': 'py', 'Austrália': 'au', 'Turquia': 'tr',
  'Alemanha': 'de', 'Curaçao': 'cw', 'Costa do Marfim': 'ci', 'Equador': 'ec',
  'Holanda': 'nl', 'Japão': 'jp', 'Suécia': 'se', 'Tunísia': 'tn',
  'Bélgica': 'be', 'Egito': 'eg', 'Irã': 'ir', 'Nova Zelândia': 'nz',
  'Espanha': 'es', 'Cabo Verde': 'cv', 'Arábia Saudita': 'sa', 'Uruguai': 'uy',
  'França': 'fr', 'Senegal': 'sn', 'Iraque': 'iq', 'Noruega': 'no',
  'Argentina': 'ar', 'Argélia': 'dz', 'Áustria': 'at', 'Jordânia': 'jo',
  'Portugal': 'pt', 'Congo (RDC)': 'cd', 'Uzbequistão': 'uz', 'Colômbia': 'co',
  'Inglaterra': 'gb-eng', 'Croácia': 'hr', 'Gana': 'gh', 'Panamá': 'pa',
};

// Posição aproximada no Ranking Mundial da FIFA (menor = melhor). Usado APENAS como
// último critério de desempate (fair play não é modelado — não há cartões num palpite).
export const FIFA_RANK = {
  'Argentina': 1, 'Espanha': 2, 'França': 3, 'Inglaterra': 4, 'Brasil': 5,
  'Portugal': 6, 'Holanda': 7, 'Bélgica': 8, 'Alemanha': 9, 'Croácia': 10,
  'Marrocos': 11, 'Colômbia': 12, 'Uruguai': 13, 'Estados Unidos': 14, 'México': 15,
  'Suíça': 16, 'Senegal': 17, 'Japão': 18, 'Irã': 19, 'Coreia do Sul': 20,
  'Austrália': 21, 'Equador': 22, 'Áustria': 23, 'Suécia': 24, 'Turquia': 25,
  'Egito': 26, 'Noruega': 27, 'Canadá': 28, 'Costa do Marfim': 29, 'Catar': 30,
  'Arábia Saudita': 31, 'Escócia': 32, 'Paraguai': 33, 'Tunísia': 34, 'Argélia': 35,
  'Tchéquia': 36, 'Panamá': 37, 'Uzbequistão': 38, 'Jordânia': 39, 'Iraque': 40,
  'África do Sul': 41, 'Bósnia e Herzegovina': 42, 'Gana': 43, 'Cabo Verde': 44,
  'Congo (RDC)': 45, 'Curaçao': 46, 'Nova Zelândia': 47, 'Haiti': 48,
};

// Nomes em inglês (e variações comuns) -> nome interno em PT. Usado para casar os
// jogos vindos do football-data.org com as seleções do bolão.
export const EN_TO_PT = {
  'mexico': 'México', 'south africa': 'África do Sul', 'south korea': 'Coreia do Sul',
  'korea republic': 'Coreia do Sul', 'czech republic': 'Tchéquia', 'czechia': 'Tchéquia',
  'canada': 'Canadá', 'bosnia and herzegovina': 'Bósnia e Herzegovina', 'bosnia-herzegovina': 'Bósnia e Herzegovina', 'bosniaherzegovina': 'Bósnia e Herzegovina',
  'qatar': 'Catar', 'switzerland': 'Suíça', 'brazil': 'Brasil', 'morocco': 'Marrocos',
  'haiti': 'Haiti', 'scotland': 'Escócia', 'united states': 'Estados Unidos', 'usa': 'Estados Unidos',
  'paraguay': 'Paraguai', 'australia': 'Austrália', 'turkey': 'Turquia', 'türkiye': 'Turquia', 'turkiye': 'Turquia',
  'germany': 'Alemanha', 'curacao': 'Curaçao', 'curaçao': 'Curaçao', 'ivory coast': 'Costa do Marfim',
  "cote d'ivoire": 'Costa do Marfim', 'côte d’ivoire': 'Costa do Marfim', 'ecuador': 'Equador',
  'netherlands': 'Holanda', 'japan': 'Japão', 'sweden': 'Suécia', 'tunisia': 'Tunísia',
  'belgium': 'Bélgica', 'egypt': 'Egito', 'iran': 'Irã', 'new zealand': 'Nova Zelândia',
  'spain': 'Espanha', 'cape verde': 'Cabo Verde', 'cape verde islands': 'Cabo Verde', 'cabo verde': 'Cabo Verde', 'saudi arabia': 'Arábia Saudita',
  'uruguay': 'Uruguai', 'france': 'França', 'senegal': 'Senegal', 'iraq': 'Iraque', 'norway': 'Noruega',
  'argentina': 'Argentina', 'algeria': 'Argélia', 'austria': 'Áustria', 'jordan': 'Jordânia',
  'portugal': 'Portugal', 'dr congo': 'Congo (RDC)', 'congo dr': 'Congo (RDC)', 'democratic republic of congo': 'Congo (RDC)',
  'uzbekistan': 'Uzbequistão', 'colombia': 'Colômbia', 'england': 'Inglaterra', 'croatia': 'Croácia',
  'ghana': 'Gana', 'panama': 'Panamá',
};

// Ordem de uma rodada simples (single round-robin) para 4 times: índices 0..3.
const ROUND_ROBIN = [
  [[0, 1], [2, 3]], // rodada 1
  [[0, 2], [3, 1]], // rodada 2
  [[3, 0], [1, 2]], // rodada 3
];

// ---- Pareamentos OFICIAIS do mata-mata (Anexo C / FIFA) ----
// Cada entrada usa "seeds": '1A' = 1º Grupo A, '2A' = 2º Grupo A, 'BTxx' = melhor 3º
// alocado ao slot do jogo xx (8 slots), 'W{ord}' = vencedor do jogo de ord N,
// 'L{ord}' = perdedor. ord 72-87 = 16-avos, 88-95 = oitavas, 96-99 = quartas,
// 100-101 = semis, 102 = 3º lugar, 103 = final. ord+1 = nº do jogo FIFA (73-104).
export const KO_SEEDS = {
  // 16-avos (FIFA Match 73-88)
  72: { home: '2A', away: '2B' },    // M73 — Los Angeles
  73: { home: '1E', away: 'BT74' },  // M74 — Boston (3º de A/B/C/D/F)
  74: { home: '1F', away: '2C' },    // M75 — Monterrey
  75: { home: '1C', away: '2F' },    // M76 — Houston
  76: { home: '1I', away: 'BT77' },  // M77 — New York/NJ (3º de C/D/F/G/H)
  77: { home: '2E', away: '2I' },    // M78 — Dallas
  78: { home: '1A', away: 'BT79' },  // M79 — Cidade do México (3º de C/E/F/H/I)
  79: { home: '1L', away: 'BT80' },  // M80 — Atlanta (3º de E/H/I/J/K)
  80: { home: '1D', away: 'BT81' },  // M81 — São Francisco (3º de B/E/F/I/J)
  81: { home: '1G', away: 'BT82' },  // M82 — Seattle (3º de A/E/H/I/J)
  82: { home: '2K', away: '2L' },    // M83 — Toronto
  83: { home: '1H', away: '2J' },    // M84 — Los Angeles
  84: { home: '1B', away: 'BT85' },  // M85 — Vancouver (3º de E/F/G/I/J)
  85: { home: '1J', away: '2H' },    // M86 — Miami
  86: { home: '1K', away: 'BT87' },  // M87 — Kansas City (3º de D/E/I/J/L)
  87: { home: '2D', away: '2G' },    // M88 — Dallas
  // Oitavas (FIFA M89-96)
  88: { home: 'W73', away: 'W76' },  // M89 — vencedor M74 × M77
  89: { home: 'W72', away: 'W74' },  // M90 — vencedor M73 × M75
  90: { home: 'W75', away: 'W77' },  // M91 — vencedor M76 × M78
  91: { home: 'W78', away: 'W79' },  // M92 — vencedor M79 × M80
  92: { home: 'W82', away: 'W83' },  // M93 — vencedor M83 × M84
  93: { home: 'W80', away: 'W81' },  // M94 — vencedor M81 × M82
  94: { home: 'W85', away: 'W87' },  // M95 — vencedor M86 × M88
  95: { home: 'W84', away: 'W86' },  // M96 — vencedor M85 × M87
  // Quartas (FIFA M97-100)
  96: { home: 'W88', away: 'W89' },  // M97 — vencedor M89 × M90
  97: { home: 'W92', away: 'W93' },  // M98 — vencedor M93 × M94
  98: { home: 'W90', away: 'W91' },  // M99 — vencedor M91 × M92
  99: { home: 'W94', away: 'W95' },  // M100 — vencedor M95 × M96
  // Semis (FIFA M101-102)
  100: { home: 'W96', away: 'W97' }, // M101 — vencedor M97 × M98
  101: { home: 'W98', away: 'W99' }, // M102 — vencedor M99 × M100
  // 3º lugar (M103) e Final (M104)
  102: { home: 'L100', away: 'L101' },
  103: { home: 'W100', away: 'W101' },
};

// Slots dos 8 "Melhores 3ºs": cada slot só aceita 3º dos grupos listados (Anexo C).
// A chave bate com o "BTxx" usado em KO_SEEDS.
export const BT_SLOTS = {
  BT74: ['A', 'C', 'D', 'B', 'F'],  // D antes de B: alinha com tabela oficial FIFA Anexo C
  BT77: ['C', 'F', 'D', 'G', 'H'],  // F antes de D: alinha com tabela oficial FIFA Anexo C
  BT79: ['C', 'E', 'F', 'H', 'I'],
  BT80: ['E', 'H', 'I', 'J', 'K'],
  BT81: ['B', 'E', 'F', 'I', 'J'],
  BT82: ['A', 'E', 'H', 'I', 'J'],
  BT85: ['E', 'F', 'G', 'I', 'J'],
  BT87: ['D', 'E', 'I', 'J', 'L'],
};

// Rótulo legível para um seed (usado na UI antes da resolução).
export function seedLabel(seed) {
  if (!seed) return 'A definir';
  if (/^1[A-L]$/.test(seed)) return `1º Grupo ${seed[1]}`;
  if (/^2[A-L]$/.test(seed)) return `2º Grupo ${seed[1]}`;
  if (seed.startsWith('BT')) {
    const opts = BT_SLOTS[seed];
    return opts ? `Melhor 3º (${opts.join('/')})` : 'Melhor 3º';
  }
  if (seed.startsWith('W')) return `Vencedor jogo ${Number(seed.slice(1)) + 1}`;
  if (seed.startsWith('L')) return `Perdedor jogo ${Number(seed.slice(1)) + 1}`;
  return 'A definir';
}

function isoDate(year, month, day, hour = 16) {
  // month é 1-based aqui por conveniência.
  const d = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  return d.toISOString();
}

// Gera a lista completa de partidas (104) de um bolão.
// Fase de grupos com times reais; mata-mata com vagas a definir (admin preenche).
export function buildFixtures() {
  const matches = [];
  let ord = 0;
  const groupLetters = Object.keys(GROUPS);

  // ---- Fase de grupos: 72 jogos (6 por grupo) ----
  // Espalhamos as 3 rodadas ao longo de 11–27 de junho de 2026.
  groupLetters.forEach((g, gi) => {
    const teams = GROUPS[g];
    ROUND_ROBIN.forEach((round, ri) => {
      // Datas aproximadas por rodada.
      const baseDay = [11, 18, 24][ri] + Math.floor(gi / 2);
      round.forEach(([hi, ai]) => {
        matches.push({
          ord: ord++,
          stage: 'group',
          group_label: g,
          round_label: `Grupo ${g} · ${ri + 1}ª rodada`,
          home_team: teams[hi],
          away_team: teams[ai],
          home_label: null,
          away_label: null,
          kickoff: isoDate(2026, 6, Math.min(baseDay, 27), 16 + (hi % 4)),
        });
      });
    });
  });

  // ---- Mata-mata: pareamentos OFICIAIS (Anexo C). Times nulos no início; o servidor
  //      preenche home_team/away_team automaticamente conforme as fases terminam. ----
  const spreadDate = (startISO, endISO, i, count) => {
    const s = Date.parse(startISO), e = Date.parse(endISO);
    const t = count <= 1 ? s : s + Math.round(((e - s) * i) / (count - 1));
    return new Date(t).toISOString();
  };
  const koStages = [
    ['r32', '16-avos', 16, '2026-06-28T16:00:00Z', '2026-07-03T23:00:00Z'],
    ['r16', 'Oitavas', 8, '2026-07-04T16:00:00Z', '2026-07-07T23:00:00Z'],
    ['qf', 'Quartas', 4, '2026-07-09T20:00:00Z', '2026-07-11T23:00:00Z'],
    ['sf', 'Semifinal', 2, '2026-07-14T22:00:00Z', '2026-07-15T22:00:00Z'],
    ['third', 'Disputa do 3º lugar', 1, '2026-07-18T20:00:00Z', '2026-07-18T20:00:00Z'],
    ['final', 'FINAL', 1, '2026-07-19T19:00:00Z', '2026-07-19T19:00:00Z'],
  ];
  for (const [stage, label, count, startISO, endISO] of koStages) {
    for (let i = 0; i < count; i++) {
      const seed = KO_SEEDS[ord] || {};
      const fifaNum = ord + 1; // nº oficial do jogo (R32 = 73..88, ...)
      const single = stage === 'third' || stage === 'final';
      matches.push({
        ord,
        stage,
        group_label: null,
        round_label: single ? label : `${label} · Jogo ${fifaNum}`,
        home_team: null,
        away_team: null,
        home_label: seedLabel(seed.home),
        away_label: seedLabel(seed.away),
        kickoff: spreadDate(startISO, endISO, i, count),
      });
      ord++;
    }
  }


  return matches;
}

export const STAGE_NAMES = {
  group: 'Fase de Grupos',
  r32: '16-avos de final',
  r16: 'Oitavas de final',
  qf: 'Quartas de final',
  sf: 'Semifinais',
  third: '3º lugar',
  final: 'Final',
};
