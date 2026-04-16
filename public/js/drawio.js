// FlowGraph → draw.io XML (.drawio) の生成
//
// draw.io は mxGraph XML 形式を使用する。
// ノードの x/y 座標はシンプルなランク付きレイアウトで計算する。
// （ループバック辺はレイアウト計算から除外し、辺だけ追加する）

// -------------------------------------------------------
// スタイル定義
// -------------------------------------------------------
const STYLES = {
  start:          'ellipse;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;',
  end:            'ellipse;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;',
  function_start: 'shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;fillColor=#d5e8d4;strokeColor=#82b366;',
  process:        'rounded=1;whiteSpace=wrap;html=1;',
  decision:       'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;',
}

const NODE_W  = 160
const NODE_H  = 50
const DEC_W   = 160
const DEC_H   = 70
const GAP_X   = 60
const GAP_Y   = 70

// -------------------------------------------------------
// メイン関数
// -------------------------------------------------------

/**
 * @param {{ nodes: Map<string, {type:string,label:string}>, edges: Array<{from:string,to:string,label?:string}> }} graph
 * @returns {string}  draw.io XML 文字列
 */
export function generateDrawio(graph) {
  const positions = computeLayout(graph)
  return buildXml(graph, positions)
}

export function downloadDrawio(graph, filename = 'flowchart.drawio') {
  const xml  = generateDrawio(graph)
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// -------------------------------------------------------
// レイアウト計算（ツリー構造を考慮したレイアウト）
// -------------------------------------------------------

function computeLayout(graph) {
  const backEdgeKeys = detectBackEdges(graph)

  // 後退辺を除いた前向き隣接リスト
  const fwdAdj = new Map()
  for (const id of graph.nodes.keys()) fwdAdj.set(id, [])
  for (const { from, to } of graph.edges) {
    if (!backEdgeKeys.has(`${from}->${to}`)) {
      fwdAdj.get(from)?.push(to)
    }
  }

  // ランク（y 位置用）を計算
  const rankMap = assignRanks(graph)

  // ① サブツリー幅をボトムアップで計算
  //    DAG なので複数の親を持つノードがある。その場合は「最初に訪問した親」だけが
  //    サブツリーに含め、以降の親からは幅 0 として扱う（収束ノード）。
  const claimed   = new Set()   // サブツリーに取り込み済みのノード
  const subtreeW  = new Map()   // ノード → サブツリー幅

  // トポロジカル逆順（ランク降順）に処理
  const sortedByRankDesc = [...graph.nodes.keys()].sort(
    (a, b) => (rankMap.get(b) ?? 0) - (rankMap.get(a) ?? 0)
  )

  for (const id of sortedByRankDesc) {
    const children = (fwdAdj.get(id) ?? []).filter(c => !claimed.has(c))
    // このノードが「最初に訪問した親」として子を取り込む
    for (const c of children) claimed.add(c)

    const nodeW = graph.nodes.get(id)?.type === 'decision' ? DEC_W : NODE_W

    if (children.length === 0) {
      subtreeW.set(id, nodeW)
    } else {
      const childrenTotal = children.reduce((sum, c) => sum + (subtreeW.get(c) ?? nodeW), 0)
                          + (children.length - 1) * GAP_X
      subtreeW.set(id, Math.max(nodeW, childrenTotal))
    }
  }

  // ② x 座標をトップダウンで割り当て
  //    各ノードの「中心 x」を centerX に記録し、後で左上座標に変換する
  const centerX = new Map()
  const positions = {}

  // ルートノード（入次数 0 のノード、後退辺除く）を探す
  const inDegFwd = new Map()
  for (const id of graph.nodes.keys()) inDegFwd.set(id, 0)
  for (const { from, to } of graph.edges) {
    if (!backEdgeKeys.has(`${from}->${to}`)) {
      inDegFwd.set(to, (inDegFwd.get(to) ?? 0) + 1)
    }
  }

  // ランク昇順にトップダウンで x を決定
  const sortedByRankAsc = [...graph.nodes.keys()].sort(
    (a, b) => (rankMap.get(a) ?? 0) - (rankMap.get(b) ?? 0)
  )

  const CANVAS_CENTER_X = 500

  for (const id of sortedByRankAsc) {
    // まだ x が決まっていない場合（ルートノードや孤立ノード）
    if (!centerX.has(id)) {
      centerX.set(id, CANVAS_CENTER_X)
    }

    const cx       = centerX.get(id)
    const children = (fwdAdj.get(id) ?? [])

    if (children.length === 0) continue

    // 子ノードを左から並べる。取り込み済みの子（別の親にすでに割り当て済み）は
    // その位置をそのまま使い、未割り当ての子だけここで配置する。
    const unassigned = children.filter(c => !centerX.has(c))

    if (unassigned.length === 0) continue

    // unassigned の各サブツリー幅の合計
    const totalW = unassigned.reduce((s, c) => s + (subtreeW.get(c) ?? NODE_W), 0)
                 + (unassigned.length - 1) * GAP_X

    // 親の中心を基準に左詰め配置
    let curX = cx - totalW / 2

    for (const c of unassigned) {
      const sw = subtreeW.get(c) ?? NODE_W
      const childCx = curX + sw / 2
      // まだ割り当てられていない場合のみセット（先着優先）
      if (!centerX.has(c)) centerX.set(c, childCx)
      curX += sw + GAP_X
    }
  }

  // ③ 最終座標をまとめる（中心 x → 左上 x）
  for (const id of graph.nodes.keys()) {
    const node  = graph.nodes.get(id)
    const w     = node?.type === 'decision' ? DEC_W : NODE_W
    const h     = node?.type === 'decision' ? DEC_H : NODE_H
    const rank  = rankMap.get(id) ?? 0
    const cx    = centerX.get(id) ?? CANVAS_CENTER_X
    const y     = 40 + rank * (NODE_H + GAP_Y)
    positions[id] = { x: cx - w / 2, y, w, h }
  }

  return positions
}

function assignRanks(graph) {
  // ① DFS で後退辺（サイクルを作る辺）を検出し除外してから BFS でランク計算
  const backEdgeKeys = detectBackEdges(graph)

  const adj   = new Map()
  const inDeg = new Map()
  for (const id of graph.nodes.keys()) {
    adj.set(id, [])
    inDeg.set(id, 0)
  }
  for (const { from, to } of graph.edges) {
    if (backEdgeKeys.has(`${from}->${to}`)) continue  // 後退辺はスキップ
    adj.get(from)?.push(to)
    inDeg.set(to, (inDeg.get(to) ?? 0) + 1)
  }

  // ② トポロジカル BFS
  const rank  = new Map()
  const queue = []
  for (const [id, deg] of inDeg) {
    if (deg === 0) { rank.set(id, 0); queue.push(id) }
  }

  let head = 0
  while (head < queue.length) {
    const u = queue[head++]
    const r = rank.get(u) ?? 0
    for (const v of (adj.get(u) ?? [])) {
      const nr = r + 1
      if (!rank.has(v) || rank.get(v) < nr) rank.set(v, nr)
      inDeg.set(v, inDeg.get(v) - 1)
      if (inDeg.get(v) === 0) queue.push(v)
    }
  }

  // 未到達ノードは末尾に付ける
  let maxRank = rank.size ? Math.max(...rank.values()) : 0
  for (const id of graph.nodes.keys()) {
    if (!rank.has(id)) rank.set(id, ++maxRank)
  }

  return rank
}

function detectBackEdges(graph) {
  // DFS で、訪問中スタックにある辺を後退辺として検出
  const visited = new Set()
  const inStack = new Set()
  const back    = new Set()

  const adj = new Map()
  for (const id of graph.nodes.keys()) adj.set(id, [])
  for (const { from, to } of graph.edges) adj.get(from)?.push(to)

  function dfs(u) {
    visited.add(u)
    inStack.add(u)
    for (const v of (adj.get(u) ?? [])) {
      if (!visited.has(v)) {
        dfs(v)
      } else if (inStack.has(v)) {
        back.add(`${u}->${v}`)
      }
    }
    inStack.delete(u)
  }

  for (const id of graph.nodes.keys()) {
    if (!visited.has(id)) dfs(id)
  }

  return back
}

// -------------------------------------------------------
// XML 生成
// -------------------------------------------------------

function buildXml(graph, positions) {
  const cells = []
  let edgeId  = graph.nodes.size + 10

  // ノード
  for (const [id, node] of graph.nodes) {
    const pos   = positions[id] ?? { x: 100, y: 100, w: NODE_W, h: NODE_H }
    const style = STYLES[node.type] ?? STYLES.process
    const label = xmlEsc(node.label)
    cells.push(
      `    <mxCell id="${xmlEsc(id)}" value="${label}" style="${style}" vertex="1" parent="1">\n` +
      `      <mxGeometry x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" as="geometry" />\n` +
      `    </mxCell>`
    )
  }

  // 辺
  for (const { from, to, label } of graph.edges) {
    const eid   = `e${edgeId++}`
    const lattr = label ? ` value="${xmlEsc(label)}"` : ' value=""'
    cells.push(
      `    <mxCell id="${eid}"${lattr} style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="${xmlEsc(from)}" target="${xmlEsc(to)}" parent="1">\n` +
      `      <mxGeometry relative="1" as="geometry" />\n` +
      `    </mxCell>`
    )
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<mxGraphModel>\n` +
    `  <root>\n` +
    `    <mxCell id="0" />\n` +
    `    <mxCell id="1" parent="0" />\n` +
    cells.join('\n') + '\n' +
    `  </root>\n` +
    `</mxGraphModel>`
  )
}

function xmlEsc(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
