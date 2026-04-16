// UIイベントとフローチャート生成の統合エントリーポイント

import { initParser, parseCode, detectLanguageFromCode, LANGUAGE_LABELS } from './parser.js'
import { Analyzer } from './analyzer.js'
import { generateMermaid, generateMermaidPerFunction } from './generator.js'
import { downloadSVG, downloadPNG } from './exporter.js'
import { downloadDrawio } from './drawio.js'

// Mermaid + ELK レイアウトを読み込む
let mermaid = null
async function loadMermaid() {
  if (mermaid) return mermaid

  const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
  mermaid = mod.default

  // ELK レイアウトをロード（ループバック辺を含むグラフに対応）
  try {
    const elkMod = await import('/js/vendor/layout-elk/mermaid-layout-elk.esm.min.mjs')
    mermaid.registerLayoutLoaders(elkMod.default)
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      layout: 'elk',
      elk: {
        layoutOptions: {
          'elk.direction': 'DOWN',
          // モデルに記述された辺の順でサイクルを解析 → start が必ず上に来る
          'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
          'elk.layered.spacing.nodeNodeBetweenLayers': '40',
          'elk.spacing.nodeNode': '20',
        },
      },
      flowchart: { padding: 20, useMaxWidth: false },
    })
    console.log('ELK レイアウトを使用します')
  } catch (e) {
    console.warn('ELK ロード失敗、Dagre にフォールバック:', e.message)
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      flowchart: { curve: 'linear', padding: 20, useMaxWidth: false },
    })
  }
  return mermaid
}

// -------------------------------------------------------
// DOM 要素
// -------------------------------------------------------
const dropZone         = document.getElementById('drop-zone')
const fileInput        = document.getElementById('file-input')
const statusEl         = document.getElementById('status')
const outputEl         = document.getElementById('output')
const mermaidContainer = document.getElementById('mermaid-container')
const mermaidCodeEl    = document.getElementById('mermaid-code')
const dlSvgBtn         = document.getElementById('dl-svg')
const dlPngBtn         = document.getElementById('dl-png')
const dlDrawioBtn      = document.getElementById('dl-drawio')
const viewFullBtn      = document.getElementById('view-full')
const funcSelect       = document.getElementById('func-select')
const entryLabelSelect = document.getElementById('entry-label-select')
// コード入力タブ
const codeInput        = document.getElementById('code-input')
const langSelect       = document.getElementById('lang-select')
const langDetectedEl   = document.getElementById('lang-detected')
const generateBtn      = document.getElementById('generate-btn')

// 最後に生成した SVG 文字列・グラフ（ダウンロード用）
let lastSvgString   = null
let lastGraph       = null
let funcSvgCache    = new Map()  // funcName → svg string
let currentView     = 'full'     // 'full' | funcName

// エントリラベル設定（ファイルをまたいで保持）
let entryLabelMode = localStorage.getItem('entryLabelMode') ?? 'name'
entryLabelSelect.value = entryLabelMode

// -------------------------------------------------------
// ドラッグ & ドロップ / ファイル選択
// -------------------------------------------------------
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropZone.classList.add('dragover')
})
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'))
dropZone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropZone.classList.remove('dragover')
  const file = e.dataTransfer.files[0]
  if (file) handleFile(file)
})
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0]
  if (file) handleFile(file)
})

// -------------------------------------------------------
// 入力タブ切り替え
// -------------------------------------------------------
document.querySelectorAll('.input-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.input-tab').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active')
  })
})

// -------------------------------------------------------
// コード入力タブ — 言語表示・生成
// -------------------------------------------------------
let _langDebounce = null
codeInput.addEventListener('input', () => {
  clearTimeout(_langDebounce)
  _langDebounce = setTimeout(updateLangIndicator, 300)
})

langSelect.addEventListener('change', updateLangIndicator)

function updateLangIndicator() {
  const code = codeInput.value.trim()
  if (!code) { langDetectedEl.textContent = ''; return }
  if (langSelect.value !== 'auto') { langDetectedEl.textContent = ''; return }
  const detected = detectLanguageFromCode(code)
  langDetectedEl.textContent = `→ ${LANGUAGE_LABELS[detected] ?? detected}`
}

generateBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim()
  if (!code) { setStatus('コードを入力してください', true); return }
  const language = langSelect.value === 'auto'
    ? detectLanguageFromCode(code)
    : langSelect.value
  await handleSource(code, language)
})

// コード入力タブへのファイルドロップも受け付ける
codeInput.addEventListener('dragover', e => e.preventDefault())
codeInput.addEventListener('drop', async e => {
  e.preventDefault()
  const file = e.dataTransfer.files[0]
  if (!file) return
  const text = await readFileText(file)
  codeInput.value = text
  updateLangIndicator()
})

// -------------------------------------------------------
// ダウンロードボタン
// -------------------------------------------------------
dlSvgBtn.addEventListener('click', () => {
  const svg = getCurrentSvg()
  if (!svg) { setStatus('先にファイルを読み込んでください', true); return }
  try {
    downloadSVG(svg, getFilename('svg'))
  } catch (e) {
    setStatus(`SVG ダウンロード失敗: ${e.message}`, true)
  }
})

dlPngBtn.addEventListener('click', async () => {
  const svg = getCurrentSvg()
  if (!svg) { setStatus('先にファイルを読み込んでください', true); return }
  try {
    setStatus('PNG を生成中...')
    await downloadPNG(svg, getFilename('png'))
    setStatus('PNG ダウンロード完了')
  } catch (e) {
    setStatus(`PNG ダウンロード失敗: ${e.message}`, true)
  }
})

dlDrawioBtn.addEventListener('click', () => {
  if (!lastGraph) { setStatus('先にファイルを読み込んでください', true); return }
  try {
    const graph = currentView === 'full'
      ? lastGraph
      : buildFuncGraph(lastGraph, currentView, entryLabelMode)
    downloadDrawio(graph, getFilename('drawio'))
  } catch (e) {
    setStatus(`draw.io ダウンロード失敗: ${e.message}`, true)
  }
})

// -------------------------------------------------------
// 表示切り替え（全体 / 関数選択）
// -------------------------------------------------------
viewFullBtn.addEventListener('click', () => {
  if (currentView === 'full') return
  currentView = 'full'
  viewFullBtn.classList.add('active')
  funcSelect.value = ''
  funcSelect.classList.remove('active')
  mermaidContainer.innerHTML = lastSvgString ?? ''
})

funcSelect.addEventListener('change', async () => {
  const funcName = funcSelect.value
  if (!funcName) {
    // プレースホルダーに戻った → 全体表示へ
    viewFullBtn.click()
    return
  }
  currentView = funcName
  viewFullBtn.classList.remove('active')
  funcSelect.classList.add('active')
  await showFuncView(funcName)
})

// エントリラベル設定変更
entryLabelSelect.addEventListener('change', async () => {
  entryLabelMode = entryLabelSelect.value
  localStorage.setItem('entryLabelMode', entryLabelMode)
  // 関数ビュー表示中なら再描画（キャッシュを捨てて再レンダー）
  if (currentView !== 'full') {
    funcSvgCache.delete(currentView)
    await showFuncView(currentView)
  }
})

async function showFuncView(funcName) {
  // キャッシュがあれば即表示
  if (funcSvgCache.has(funcName)) {
    mermaidContainer.innerHTML = funcSvgCache.get(funcName)
    return
  }

  setStatus(`${funcName} を描画中...`)
  const defs = generateMermaidPerFunction(lastGraph, { entryLabel: entryLabelMode })
  const def  = defs.find(d => d.name === funcName)
  if (!def) { setStatus(`関数 "${funcName}" が見つかりません`, true); return }

  const m = await loadMermaid()
  const { svg } = await m.render('mermaid-pf-' + funcName + '-' + Date.now(), def.code)
  funcSvgCache.set(funcName, svg)
  mermaidContainer.innerHTML = svg
  setStatus(`完了 (${funcName})`)
}

function populateFuncSelect(graph) {
  // 既存の選択肢をリセット
  funcSelect.innerHTML = '<option value="">関数を選択...</option>'
  if (!graph.funcGroups || graph.funcGroups.size === 0) {
    funcSelect.disabled = true
    return
  }
  for (const [name] of graph.funcGroups) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    funcSelect.appendChild(opt)
  }
  funcSelect.disabled = false
}

// -------------------------------------------------------
// メイン処理
// -------------------------------------------------------
async function handleFile(file) {
  try {
    const source = await readFileText(file)
    // 中身から言語を推定（拡張子より精度が高い場合が多い）
    const language = detectLanguageFromCode(source)
    await handleSource(source, language)
  } catch (e) {
    console.error(e)
    setStatus(`エラー: ${e.message}`, true)
  }
}

async function handleSource(source, language) {
  setStatus('読み込み中...')
  outputEl.style.display = 'none'
  lastSvgString = null
  lastGraph     = null
  funcSvgCache  = new Map()
  currentView   = 'full'
  viewFullBtn.classList.add('active')
  funcSelect.classList.remove('active')
  funcSelect.innerHTML = '<option value="">関数を選択...</option>'
  funcSelect.disabled  = true

  try {
    await generate(source, language)
  } catch (e) {
    console.error(e)
    setStatus(`エラー: ${e.message}`, true)
  }
}

async function generate(source, language = 'ino') {
  setStatus('パーサーを初期化中...')
  const parser = await initParser(language)

  setStatus('ASTを解析中...')
  const tree = parseCode(parser, source)

  const analyzer = new Analyzer(tree, language)
  const graph = analyzer.analyze()
  lastGraph = graph

  const mermaidCode = generateMermaid(graph)

  setStatus('フローチャートを描画中...')
  const m = await loadMermaid()

  // mermaid.render() で自己完結した SVG 文字列を取得
  // （DOM から outerHTML を取るよりスタイルが確実に含まれる）
  const { svg } = await m.render('mermaid-flowchart-' + Date.now(), mermaidCode)
  lastSvgString = svg

  // 表示
  mermaidContainer.innerHTML = svg

  // コードを表示
  mermaidCodeEl.textContent = mermaidCode

  populateFuncSelect(graph)
  outputEl.style.display = 'block'
  const langLabel = LANGUAGE_LABELS[language] ?? language
  setStatus(`完了 [${langLabel}]  ノード: ${graph.nodes.size}  辺: ${graph.edges.length}`)
}

// -------------------------------------------------------
// ユーティリティ
// -------------------------------------------------------
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
    reader.readAsText(file, 'UTF-8')
  })
}

/** 現在表示中の SVG を返す（ダウンロード用） */
function getCurrentSvg() {
  if (currentView === 'full') return lastSvgString
  return funcSvgCache.get(currentView) ?? lastSvgString
}

/** ダウンロードファイル名を返す */
function getFilename(ext) {
  const base = currentView === 'full' ? 'flowchart' : currentView
  return `${base}.${ext}`
}

/**
 * 特定関数のサブグラフだけを含む FlowGraph を組み立てる（draw.io 関数単位エクスポート用）
 * entryLabel が 'start' なら function_start ノードのラベルを「開始」に差し替える
 */
function buildFuncGraph(graph, funcName, entryLabel = 'name') {
  const nodeIds = graph.funcGroups?.get(funcName)
  if (!nodeIds) return graph

  const nodeSet = new Set(nodeIds)
  const nodes   = new Map()
  for (const id of nodeIds) {
    const node = graph.nodes.get(id)
    if (!node) continue
    nodes.set(id, (entryLabel === 'start' && node.type === 'function_start')
      ? { ...node, label: '開始' }
      : node)
  }
  const edges = graph.edges.filter(e => nodeSet.has(e.from) && nodeSet.has(e.to))
  return { nodes, edges, funcGroups: new Map([[funcName, nodeIds]]) }
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg
  statusEl.className = isError ? 'error' : ''
}

// 起動時に Mermaid と tree-sitter を先読み
Promise.all([loadMermaid(), initParser()]).catch((e) => {
  console.warn('事前ロード失敗 (ファイル選択時に再試行します):', e)
})
