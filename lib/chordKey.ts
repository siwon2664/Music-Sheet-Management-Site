// 코드 기호 텍스트에서 곡의 조성(Key)을 추정한다.
//
// 오선보에 찍힌 조표(#, ♭ 개수)를 이미지로 읽어내는 대신, 이미 텍스트로
// 인쇄돼 있는 코드 기호(E, F#m, C#m7, A/E ...)를 모아 조성을 추정한다.
//
// (구버전 노트) 처음엔 "등장 빈도 + 마지막 코드 보너스"만으로 판단했는데,
// C-G-D-Em처럼 네 코드가 거의 똑같은 빈도로 반복되는 흔한 팝 진행(예:
// "Golden")에서 실패하는 게 실제로 발견됐다 — 마지막 코드 하나가 OCR로
// 잘못 인식되면 그 보너스 때문에 결과가 통째로 뒤집혔다(G장조인데 Em으로
// 오판). 그래서 각 코드의 "화성적 기능"까지 반영하는 가중치 프로파일
// 방식으로 바꿨다: 12개 장조 후보 + 12개 단조 후보(총 24개) 각각에 대해
// "이 코드들이 그 조성에서 얼마나 흔히 쓰이는 역할(I, IV, V, bVII ...)에
// 해당하는지"를 다 더해 점수를 매기고, 가장 높은 후보를 택한다. 장조/단조를
// 아예 같이 놓고 점수를 매기기 때문에 "다이어토닉 세트가 같아서 장조/단조를
// 구분 못 하는" 문제와 "차용 코드가 잘못된 조성 쪽으로 점수를 몰아주는"
// 문제를 함께 완화한다. 단조 프로파일에는 harmonic minor식 장3화음 V(예:
// A단조 곡의 E)처럼 단조에서만 흔한 관용구에 더 높은 가중치를 준다.
export interface ParsedChord {
  raw: string;
  pitchClass: number; // 0=C, 1=C#, 2=D ... 11=B
  quality: 'major' | 'minor' | 'other';
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const MINOR_QUALITY_SUFFIXES = new Set(['m', 'm7', 'm9', 'm11', 'm6', 'madd9', 'm7b5']);
const OTHER_QUALITY_SUFFIXES = new Set(['dim', 'dim7', 'aug', 'sus2', 'sus4', 'sus']);

// 루트음 + 옵션(#/b) + 옵션(화음 종류) + 옵션(/베이스음, 슬래시 코드) 패턴.
const CHORD_TOKEN_RE =
  /^([A-G])(#|b)?(maj7|maj9|maj|m7b5|m7|m9|m11|m6|madd9|dim7|dim|aug|sus2|sus4|sus|add9|add11|m|6|7|9|11|13)?(\/[A-G](#|b)?)?$/;

// OCR이 '#'을 다른 문자로 잘못 읽는 경우가 흔해서(예: "F#m"이 "Fim"으로 인식됨),
// 루트 뒤에 붙은 애매한 글자 하나를 '#'으로 바꿔 재시도해본다. 그래도 코드
// 패턴에 안 맞으면 포기한다 — 무리하게 끼워 맞추지 않는다.
//
// 주의: lookahead에 '$'(문자열 끝)을 넣으면 "E1"처럼 뒤에 아무 의미도 없는
// 잡음까지 "E#"으로 둔갑시켜버린다(실제로 확인된 버그 — 잡음 하나가 존재하지
// 않는 코드를 만들어 Key 추정 전체를 뒤흔들었다). 그래서 뒤에 실제로 화음
// 종류나 슬래시 베이스가 이어질 때만 복구를 시도하도록 '$'를 뺐다 — 그
// 대신 "F#" 처럼 화음 종류 없이 딱 루트+#만 있는 코드가 오인식된 경우는
// 복구하지 못하고 그냥 버려지지만, 없는 코드를 지어내는 것보다는 안전하다.
function repairSharpMisread(token: string): string | null {
  const repaired = token.replace(/^([A-G])[iIlL1|](?=(m|maj|dim|aug|sus|add|\d|\/))/, '$1#');
  return repaired !== token ? repaired : null;
}

// 굵은 글씨/세리프 폰트를 OCR이 겹쳐 읽어 루트음이 두 번 찍히는 경우가 흔하다
// (예: "C"가 "Cc"로 인식됨 — 실제 "Golden" 샘플에서 확인됨). 대소문자만
// 다른 같은 글자가 맨 앞에 연달아 있으면 하나로 합쳐 재시도한다.
function repairDoubledRoot(token: string): string | null {
  const repaired = token.replace(/^([A-G])\1/i, '$1');
  return repaired !== token ? repaired : null;
}

// '♭'도 '#'만큼이나 자주 다른 문자로 오인식된다(예: "G♭"이 "G>", "GP",
// "G?"로 인식됨 — 실제 "I DO ME" 샘플에서 확인됨). '>', '?', 'P', ')'는
// 일반 텍스트에서 코드 자리에 잘 안 나오는 특이한 문자라, '#' 복구 때와
// 달리 문자열 끝(뒤에 화음 종류가 안 붙는 "Db"류 코드)까지 허용해도
// "E1"처럼 있지도 않은 코드를 지어낼 위험이 적다.
function repairFlatMisread(token: string): string | null {
  const repaired = token.replace(/^([A-G])[>?P)|](?=(m|maj|dim|aug|sus|add|\d|\/|$))/, '$1b');
  return repaired !== token ? repaired : null;
}

export function parseChordToken(rawToken: string): ParsedChord | null {
  const token = rawToken.trim();

  const tryParse = (t: string): ParsedChord | null => {
    const m = CHORD_TOKEN_RE.exec(t);
    if (!m) return null;
    const [, root, accidental, qualitySuffix] = m;
    let pitchClass = ROOT_PITCH_CLASS[root];
    if (accidental === '#') pitchClass = (pitchClass + 1) % 12;
    if (accidental === 'b') pitchClass = (pitchClass + 11) % 12;

    const quality: ParsedChord['quality'] = qualitySuffix && OTHER_QUALITY_SUFFIXES.has(qualitySuffix)
      ? 'other'
      : qualitySuffix && MINOR_QUALITY_SUFFIXES.has(qualitySuffix)
        ? 'minor'
        : 'major';

    return { raw: t, pitchClass, quality };
  };

  for (const candidate of [token, repairSharpMisread(token), repairDoubledRoot(token), repairFlatMisread(token)]) {
    if (!candidate) continue;
    const parsed = tryParse(candidate);
    if (parsed) return { ...parsed, raw: token };
  }
  return null;
}

// 자유 텍스트(OCR 원문)에서 코드처럼 생긴 토큰만 추출해 파싱한다. 순서는
// 원문에 등장한 순서를 그대로 유지한다 — estimateKeyFromChords가 "마지막
// 코드"를 판단하는 데 이 순서를 그대로 쓴다.
export function extractChordsFromText(text: string): ParsedChord[] {
  // 공백으로 토큰을 나누되, '|'는 구분자로도 쓰이고 '♭' 오인식 문자로도
  // 쓰일 수 있어 애매하다 — 다만 코드 사이 구분자로 훨씬 흔하므로 그대로
  // 구분자 취급한다(코드 끝에 '|'가 오는 경우는 실제로 드물다).
  const tokens = text.split(/[\s,|]+/).filter(Boolean);
  const chords: ParsedChord[] = [];
  for (const token of tokens) {
    // 가장자리 잡음만 떼어낸다. '>', '?', ')'는 repairFlatMisread가 '♭'
    // 오인식으로 다시 해석해야 하니 여기서 지워버리면 안 된다.
    const cleaned = token.replace(/^[^A-Za-z0-9#/>?)]+|[^A-Za-z0-9#/>?)]+$/g, '');
    if (!cleaned) continue;
    const parsed = parseChordToken(cleaned);
    if (parsed) chords.push(parsed);
  }
  return chords;
}

export interface KeyEstimate {
  key: string; // 예: "E", "Am"
  confidence: number; // 0~1. 1위와 2위 후보의 점수 차이 비율 — 낮으면 애매한 케이스라는 뜻
  topCandidates: { key: string; score: number }[];
}

// 토닉으로부터의 반음 간격(0=토닉) 별 가중치.
// [I, bII, II, bIII, III, IV, #IV, V, bVI, VI, bVII, VII]
// 장조: I·IV·V가 중심이고 bVI·bVII(차용 코드)도 낮지 않은 가중치를 준다 —
// CCM/팝에서 흔히 쓰여서 아예 무시하면 그쪽으로 오판하기 쉽다.
const MAJOR_PROFILE = [1.0, 0.05, 0.35, 0.25, 0.4, 0.85, 0.05, 0.9, 0.3, 0.45, 0.35, 0.15];
// 단조: i·iv·v(V)가 중심. bIII·bVI·bVII(자연단조에서 흔히 쓰이는 코드)에
// 장조보다 더 높은 가중치를 준다. v 자리는 자연단조의 단화음(v)과
// harmonic/melodic minor에서 온 장화음(V, 예: A단조 곡의 E)을 굳이
// 구분하지 않고 둘 다 "단조의 딸림 기능"으로 취급한다 — 실제로 밴드 악보는
// harmonic minor식 장3화음 V를 아주 흔하게 쓴다.
const MINOR_PROFILE = [1.0, 0.05, 0.3, 0.6, 0.1, 0.7, 0.05, 0.85, 0.65, 0.1, 0.55, 0.2];

// 각 자리(반음 간격)에서 "정상적으로 기대되는 화음 성격". 예를 들어 장조의
// ii(간격2) 자리는 원래 단화음이어야 한다. 실제 코드가 이 기대와 다르면
// (장조 ii인데 장화음이 온다든지) 그 코드 하나만 봐서는 자연스러워 보여도
// 조성 전체로 보면 안 맞는 신호이므로 점수를 깎는다. neutral/either인
// 자리는 원래 가중치 자체가 낮거나(bII, #IV 등) 장·단 둘 다 흔해서(단조의
// 딸림) 굳이 페널티를 주지 않는다.
//
// 이 보정이 왜 필요한지 보여준 실제 사례: "I DO ME"의 Gb-Absus4-Bbm7-Db
// 반복 진행은 성격만 보면 Db 기준 IV-V-vi-I(전부 기대 성격과 정확히
// 일치)로 읽는 쪽이, Gb 기준 I-ii-iii-V(ii 자리에 와야 할 단화음 대신
// 장화음이 옴)로 읽는 쪽보다 실제로 더 "교과서적"이다. 빈도만 보는
// 알고리즘은 이 차이를 못 잡아서 코드 자체는 Gb로 시작하는데도 Db로 오판할
// 수 있다 — 화음 성격 일치도를 반영하면 이런 애매한 경우에서 조금 더
// 정교하게 판단할 수 있다(다만 이것도 완벽하진 않다: 조표를 직접 읽지
// 않는 한, 이런 진행은 원래 코드만으로는 확신하기 어려운 경우가 있다).
const MAJOR_EXPECTED_QUALITY = [
  'major', 'neutral', 'minor', 'neutral', 'minor', 'major', 'neutral', 'major', 'neutral', 'minor', 'neutral', 'neutral',
] as const;
const MINOR_EXPECTED_QUALITY = [
  'minor', 'neutral', 'neutral', 'major', 'neutral', 'minor', 'neutral', 'either', 'major', 'neutral', 'major', 'neutral',
] as const;

function qualityMultiplier(expected: string, actual: ParsedChord['quality']): number {
  if (expected === 'neutral' || expected === 'either') return 1.0;
  if (actual === 'other') return 0.75; // sus/dim 등은 장/단이 불분명하니 살짝만 깎는다
  return expected === actual ? 1.0 : 0.5;
}

function weightedProfileScore(
  chords: ParsedChord[],
  root: number,
  profile: number[],
  expectedQuality: readonly string[]
): number {
  let score = 0;
  for (const c of chords) {
    const interval = (c.pitchClass - root + 12) % 12;
    score += profile[interval] * qualityMultiplier(expectedQuality[interval], c.quality);
  }
  return score;
}

export function estimateKeyFromChords(chords: ParsedChord[]): KeyEstimate | null {
  // 토닉 후보는 장/단 3화음 성격을 가진 코드만 본다 (dim/aug/sus 등은 제외 —
  // 이런 코드가 조성의 중심(토닉)인 경우는 사실상 없다). 다만 화성적 기능
  // 점수 자체는 sus/dim 코드도 포함한 전체 코드로 계산한다 — 예를 들어
  // Vsus4도 딸림 기능을 하기 때문이다.
  const candidates = chords.filter((c) => c.quality === 'major' || c.quality === 'minor');
  if (candidates.length === 0) return null;

  const hypotheses: { key: string; score: number }[] = [];
  for (let root = 0; root < 12; root++) {
    hypotheses.push({
      key: NOTE_NAMES_SHARP[root],
      score: weightedProfileScore(chords, root, MAJOR_PROFILE, MAJOR_EXPECTED_QUALITY),
    });
    hypotheses.push({
      key: `${NOTE_NAMES_SHARP[root]}m`,
      score: weightedProfileScore(chords, root, MINOR_PROFILE, MINOR_EXPECTED_QUALITY),
    });
  }
  hypotheses.sort((a, b) => b.score - a.score);

  const top = hypotheses[0];
  const second = hypotheses[1];
  const confidence = top.score > 0 ? Math.max(0, Math.min(1, (top.score - second.score) / top.score)) : 0;

  return { key: top.key, confidence, topCandidates: hypotheses.slice(0, 3) };
}
