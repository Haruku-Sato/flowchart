// web-tree-sitter の初期化と各言語のパース

const GRAMMAR_WASM = {
  ino:    '/wasm/tree-sitter-cpp.wasm',   // Arduino (.ino) は C++ 文法を使用
  cpp:    '/wasm/tree-sitter-cpp.wasm',
  c:      '/wasm/tree-sitter-c.wasm',
  csharp: '/wasm/tree-sitter-c_sharp.wasm',
}

/** ファイル名から言語識別子を返す（補助用） */
export function detectLanguage(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  switch (ext) {
    case 'ino':  return 'ino'
    case 'c':    return 'c'
    case 'cpp':  return 'cpp'
    case 'cs':   return 'csharp'
    default:     return 'cpp'
  }
}

/** ソースコードの内容から言語を推定する */
export function detectLanguageFromCode(source) {
  const s = source
  const scores = { ino: 0, csharp: 0, cpp: 0, c: 0 }

  // C# (最も特徴的)
  if (/\bnamespace\s+\w/.test(s))                         scores.csharp += 10
  if (/\busing\s+System\b/.test(s))                       scores.csharp += 8
  if (/\bConsole\./.test(s))                              scores.csharp += 6
  if (/\bforeach\s*\(/.test(s))                           scores.csharp += 6
  if (/\b(?:List|Dictionary|IEnumerable)</.test(s))       scores.csharp += 6
  if (/\bpublic\s+(?:static\s+)?(?:void|int|string|bool)/.test(s)) scores.csharp += 3
  if (/\bvar\s+\w+\s*=/.test(s))                         scores.csharp += 2
  if (/=>/.test(s))                                       scores.csharp += 1

  // Arduino
  if (/\bvoid\s+setup\s*\(\s*\)/.test(s))                scores.ino += 10
  if (/\bvoid\s+loop\s*\(\s*\)/.test(s))                 scores.ino += 10
  if (/\b(?:pinMode|digitalWrite|digitalRead|analogRead|analogWrite)\s*\(/.test(s)) scores.ino += 6
  if (/\bSerial\./.test(s))                              scores.ino += 5
  if (/\bdelay\s*\(\d/.test(s))                          scores.ino += 2

  // C++
  if (/\bstd::/.test(s))                                 scores.cpp += 8
  if (/\bcout\s*<</.test(s))                             scores.cpp += 6
  if (/\bcin\s*>>/.test(s))                              scores.cpp += 6
  if (/\btemplate\s*</.test(s))                          scores.cpp += 8
  if (/#include\s*<iostream>/.test(s))                   scores.cpp += 5
  if (/\bnew\s+\w/.test(s))                              scores.cpp += 2
  if (/::/.test(s))                                      scores.cpp += 2

  // C
  if (/#include\s*<stdio\.h>/.test(s))                   scores.c += 8
  if (/\bprintf\s*\(/.test(s))                           scores.c += 5
  if (/\bscanf\s*\(/.test(s))                            scores.c += 5
  if (/\bmalloc\s*\(/.test(s))                           scores.c += 4
  if (/\bfree\s*\(/.test(s))                             scores.c += 3

  const max = Math.max(...Object.values(scores))
  if (max === 0) return 'c'
  return Object.entries(scores).find(([, v]) => v === max)[0]
}

export const LANGUAGE_LABELS = {
  ino:    'Arduino (C++)',
  cpp:    'C++',
  c:      'C',
  csharp: 'C#',
}

// ランタイム初期化（1回のみ）
let _initPromise = null
// 言語 → パーサーインスタンスのキャッシュ
const _parsers = new Map()

export async function initParser(language = 'ino') {
  if (_parsers.has(language)) return _parsers.get(language)

  // TreeSitter ランタイムを一度だけ初期化
  if (!_initPromise) {
    _initPromise = (async () => {
      await loadScript('/js/vendor/tree-sitter.js')
      await window.TreeSitter.init({ locateFile: f => `/wasm/${f}` })
    })()
  }
  await _initPromise

  // 別の並行呼び出しがすでに登録した場合
  if (_parsers.has(language)) return _parsers.get(language)

  const wasmPath = GRAMMAR_WASM[language] ?? GRAMMAR_WASM.cpp
  const Lang   = await window.TreeSitter.Language.load(wasmPath)
  const parser = new window.TreeSitter()
  parser.setLanguage(Lang)
  _parsers.set(language, parser)
  return parser
}

export function parseCode(parser, source) {
  return parser.parse(source)
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src
    s.onload  = resolve
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(s)
  })
}
