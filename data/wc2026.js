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
  'canada': 'Canadá', 'bosnia and herzegovina': 'Bósnia e Herzegovina', 'bosnia-herzegovina': 'Bósnia e Herzegovina',
  'qatar': 'Catar', 'switzerland': 'Suíça', 'brazil': 'Brasil', 'morocco': 'Marrocos',
  'haiti': 'Haiti', 'scotland': 'Escócia', 'united states': 'Estados Unidos', 'usa': 'Estados Unidos',
  'paraguay': 'Paraguai', 'australia': 'Austrália', 'turkey': 'Turquia', 'türkiye': 'Turquia', 'turkiye': 'Turquia',
  'germany': 'Alemanha', 'curacao': 'Curaçao', 'curaçao': 'Curaçao', 'ivory coast': 'Costa do Marfim',
  "cote d'ivoire": 'Costa do Marfim', 'côte d’ivoire': 'Costa do Marfim', 'ecuador': 'Equador',
  'netherlands': 'Holanda', 'japan': 'Japão', 'sweden': 'Suécia', 'tunisia': 'Tunísia',
  'belgium': 'Bélgica', 'egypt': 'Egito', 'iran': 'Irã', 'new zealand': 'Nova Zelândia',
  'spain': 'Espanha', 'cape verde': 'Cabo Verde', 'cabo verde': 'Cabo Verde', 'saudi arabia': 'Arábia Saudita',
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

  // ---- Mata-mata: vagas a definir, preenchidas pelo admin ----
  const ko = (stage, count, startDay, endDay, labelFn) => {
    for (let i = 0; i < count; i++) {
      const day = startDay + Math.round((i * (endDay - startDay)) / Math.max(1, count - 1));
      matches.push({
        ord: ord++,
        stage,
        group_label: null,
        round_label: labelFn(i),
        home_team: null,
        away_team: null,
        home_label: `Vaga ${i * 2 + 1}`,
        away_label: `Vaga ${i * 2 + 2}`,
        kickoff: isoDate(2026, 7, day, 16),
      });
    }
  };

  // Round of 32 (16 jogos): 28/jun a 03/jul.
  for (let i = 0; i < 16; i++) {
    const day = 28 + Math.floor((i * 6) / 16);
    matches.push({
      ord: ord++, stage: 'r32', group_label: null,
      round_label: `16-avos · Jogo ${i + 1}`,
      home_team: null, away_team: null,
      home_label: `Classificado ${i * 2 + 1}`, away_label: `Classificado ${i * 2 + 2}`,
      kickoff: isoDate(2026, day > 30 ? 7 : 6, day > 30 ? day - 30 : day, 16),
    });
  }
  ko('r16', 8, 4, 7, (i) => `Oitavas · Jogo ${i + 1}`);
  ko('qf', 4, 9, 11, (i) => `Quartas · Jogo ${i + 1}`);
  ko('sf', 2, 14, 15, (i) => `Semifinal · Jogo ${i + 1}`);
  ko('third', 1, 18, 18, () => `Disputa do 3º lugar`);
  ko('final', 1, 19, 19, () => `FINAL`);

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
