// FlowGraph → Mermaid flowchart TD テキストを生成

/**
 * 関数ごとに独立した Mermaid コードを返す
 * @returns Array<{name: string, code: string}>
 */
/**
 * @param {{ entryLabel?: 'name'|'start' }} [opts]
 * @returns Array<{name: string, code: string}>
 */
export function generateMermaidPerFunction(graph, { entryLabel = 'name' } = {}) {
  if (!graph.funcGroups || graph.funcGroups.size === 0) return []

  const results = []
  for (const [funcName, nodeIds] of graph.funcGroups) {
    const nodeSet = new Set(nodeIds)
    const lines = ['flowchart TD']

    for (const id of nodeIds) {
      const node = graph.nodes.get(id)
      if (!node) continue
      const display = applyEntryLabel(node, entryLabel)
      const line = formatNode(id, display)
      if (line) lines.push('    ' + line)
    }

    lines.push('')

    for (const edge of graph.edges) {
      if (nodeSet.has(edge.from) && nodeSet.has(edge.to)) {
        lines.push('    ' + formatEdge(edge))
      }
    }

    results.push({ name: funcName, code: lines.join('\n') })
  }
  return results
}

function applyEntryLabel(node, entryLabel) {
  if (entryLabel === 'start' && node.type === 'function_start') {
    return { ...node, label: '開始' }
  }
  return node
}

export function generateMermaid(graph) {
  const lines = ['flowchart TD']

  if (graph.funcGroups && graph.funcGroups.size > 0) {
    // グローバルノード（func=null: start など）
    for (const [id, node] of graph.nodes) {
      if (!node.func) {
        const line = formatNode(id, node)
        if (line) lines.push('    ' + line)
      }
    }

    // 関数ごとに subgraph で囲む
    for (const [funcName, nodeIds] of graph.funcGroups) {
      lines.push(`    subgraph ${funcName}_sg["${funcName}"]`)
      for (const id of nodeIds) {
        const node = graph.nodes.get(id)
        const line = node ? formatNode(id, node) : null
        if (line) lines.push('      ' + line)
      }
      lines.push('    end')
    }
  } else {
    // 関数グループなし: 全ノードをフラットに出力
    for (const [id, node] of graph.nodes) {
      const line = formatNode(id, node)
      if (line) lines.push('    ' + line)
    }
  }

  lines.push('')

  for (const edge of graph.edges) {
    lines.push('    ' + formatEdge(edge))
  }

  return lines.join('\n')
}

function formatNode(id, node) {
  const label = escapeLabel(node.label)

  switch (node.type) {
    case 'start':
    case 'end':
      return `${id}([${label}])`

    case 'function_start':
      return `${id}[[${label}]]`

    case 'process':
      return `${id}["${label}"]`

    case 'decision':
      return `${id}{"${label}"}`

    default:
      return null
  }
}

function formatEdge({ from, to, label }) {
  return label ? `${from} -->|${label}| ${to}` : `${from} --> ${to}`
}

function escapeLabel(text) {
  return (text || '')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\n/g, ' ')
    .trim()
}
