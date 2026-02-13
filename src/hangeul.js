// src/hangeul.js

// 1. 자모 데이터
const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];
const JUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
];
const JONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

// 2. 키보드 매핑 (영타 -> 한글 자모)
const KEY_MAP = {
  // 소문자 (기본)
  'q': 'ㅂ', 'w': 'ㅈ', 'e': 'ㄷ', 'r': 'ㄱ', 't': 'ㅅ', 'y': 'ㅛ', 'u': 'ㅕ', 'i': 'ㅑ', 'o': 'ㅐ', 'p': 'ㅔ',
  'a': 'ㅁ', 's': 'ㄴ', 'd': 'ㅇ', 'f': 'ㄹ', 'g': 'ㅎ', 'h': 'ㅗ', 'j': 'ㅓ', 'k': 'ㅏ', 'l': 'ㅣ',
  'z': 'ㅋ', 'x': 'ㅌ', 'c': 'ㅊ', 'v': 'ㅍ', 'b': 'ㅠ', 'n': 'ㅜ', 'm': 'ㅡ',

  // 대문자 (Shift) - 쌍자음 & 이중모음
  'Q': 'ㅃ', 'W': 'ㅉ', 'E': 'ㄸ', 'R': 'ㄲ', 'T': 'ㅆ', 'O': 'ㅒ', 'P': 'ㅖ',

  // 🔥 [수정됨] 대문자 (Shift) - 변화 없는 자모들 (S -> ㄴ, A -> ㅁ 등)
  'A': 'ㅁ', 'S': 'ㄴ', 'D': 'ㅇ', 'F': 'ㄹ', 'G': 'ㅎ', 'H': 'ㅗ', 'J': 'ㅓ', 'K': 'ㅏ', 'L': 'ㅣ',
  'Z': 'ㅋ', 'X': 'ㅌ', 'C': 'ㅊ', 'V': 'ㅍ', 'B': 'ㅠ', 'N': 'ㅜ', 'M': 'ㅡ',
  'Y': 'ㅛ', 'U': 'ㅕ', 'I': 'ㅑ'
};

// 3. 복합 자모 규칙
const DOUBLE_JUNG = {
  'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ'
};
const DOUBLE_JONG = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ'
};

// 유틸
const isHangul = (char) => /[가-힣]/.test(char);
const isConsonant = (char) => /[ㄱ-ㅎ]/.test(char);
const isVowel = (char) => /[ㅏ-ㅣ]/.test(char);

// 분해 함수
const disassemble = (char) => {
  if (isHangul(char)) {
    const code = char.charCodeAt(0) - 44032;
    const choIdx = Math.floor(code / 588);
    const jungIdx = Math.floor((code % 588) / 28);
    const jongIdx = code % 28;
    
    const result = [CHO[choIdx], JUNG[jungIdx]];
    if (jongIdx > 0) result.push(JONG[jongIdx]);
    return result;
  }
  if (KEY_MAP[char]) return [KEY_MAP[char]];
  return [char];
};

// 조립 함수
const assemble = (jamos) => {
  let result = '';
  let state = 0; // 0:초성대기, 1:중성대기, 2:종성대기, 3:종성완료
  let current = { cho: 0, jung: 0, jong: 0 };

  const combine = () => String.fromCharCode(44032 + (current.cho * 588) + (current.jung * 28) + current.jong);

  for (const jamo of jamos) {
    if (!isConsonant(jamo) && !isVowel(jamo)) {
      if (state === 1) result += CHO[current.cho];
      else if (state > 1) result += combine();
      result += jamo;
      state = 0;
      continue;
    }

    if (state === 0) { // 초성 대기
      if (isConsonant(jamo)) {
        current.cho = CHO.indexOf(jamo);
        state = 1;
      } else result += jamo;
    }
    else if (state === 1) { // 중성 대기
      if (isVowel(jamo)) {
        current.jung = JUNG.indexOf(jamo);
        current.jong = 0;
        state = 2;
      } else {
        result += CHO[current.cho];
        current.cho = CHO.indexOf(jamo);
      }
    }
    else if (state === 2) { // 종성 대기
      if (isConsonant(jamo)) {
        const idx = JONG.indexOf(jamo);
        if (idx > 0) {
          current.jong = idx;
          state = 3;
        } else {
          result += combine();
          current.cho = CHO.indexOf(jamo);
          state = 1;
        }
      } else {
        const prev = JUNG[current.jung];
        const comb = DOUBLE_JUNG[prev + jamo];
        if (comb) current.jung = JUNG.indexOf(comb);
        else {
          result += combine();
          result += jamo;
          state = 0;
        }
      }
    }
    else if (state === 3) { // 종성 완료
      if (isConsonant(jamo)) {
        const prev = JONG[current.jong];
        const comb = DOUBLE_JONG[prev + jamo];
        if (comb) current.jong = JONG.indexOf(comb);
        else {
          result += combine();
          current.cho = CHO.indexOf(jamo);
          state = 1;
        }
      } else { // 연음 법칙
        const jongChar = JONG[current.jong];
        current.jong = 0;
        result += combine(); 
        
        current.cho = CHO.indexOf(jongChar);
        current.jung = JUNG.indexOf(jamo);
        current.jong = 0;
        state = 2;
      }
    }
  }

  if (state === 1) result += CHO[current.cho];
  else if (state > 1) result += combine();

  return result;
};

// 최종 변환 함수
export const engToKor = (text) => {
  let jamoStream = [];
  for (const char of text) {
    jamoStream.push(...disassemble(char));
  }
  return assemble(jamoStream);
};