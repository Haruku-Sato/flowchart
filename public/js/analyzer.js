// ASTトラバーサル → FlowGraph 生成
//
// 設計方針: 明示的なマージノードを使わない "pending edges" 方式
//   各 _processXxx は pending: [{from: nodeId, label?: string}] を受け取り、
//   処理後に新しい pending リストを返す。
//   分岐の合流は「次の文のノード」に自動的に複数の pending が繋がることで実現する。
//   → 不可視ノードが不要になり、Mermaid の Dagre レイアウトが安定する。
//
// FlowGraph = {
//   nodes: Map<id:string, { type: NodeType, label: string, func: string|null }>,
//   edges: Array<{ from: string, to: string, label?: string }>,
//   funcGroups: Map<string, string[]>
// }
// NodeType: 'start' | 'end' | 'function_start' | 'process' | 'decision'
//
// 対応言語: 'ino' (Arduino/C++) | 'cpp' | 'c' | 'csharp'

export class Analyzer {
  constructor(tree, language = 'ino') {
    this.tree     = tree
    this.language = language
    this.graph    = { nodes: new Map(), edges: [], funcGroups: new Map() }
    this._counters = new Map()
  }

  analyze() {
    const root = this.tree.rootNode
    this._addNode('start', 'start', '開始')

    const funcNodes = this._findFuncNodes(root)

    if (funcNodes.length === 0) {
      const pending = this._processStatements(root.children, 'main', [{ from: 'start' }])
      this._addNode('end', 'end', '終了')
      this._connectAll(pending, 'end')
      return this.graph
    }

    const { mainFuncs, otherFuncs } = this._splitFunctions(funcNodes)

    // メイン関数群: start から順番に接続
    let pending = [{ from: 'start' }]
    for (const funcNode of mainFuncs) {
      const name    = this._getFuncName(funcNode)
      const startId = `${name}_start`
      const endId   = `${name}_end`

      this._addNode(startId, 'function_start', name, name)
      this._connectAll(pending, startId)
      const exits = this._processFunctionBody(funcNode, name, startId)
      this._addNode(endId, 'end', '終了', name)
      this._connectAll(exits, endId)

      // Arduino の loop() のみループバック
      if (name === 'loop' && this.language === 'ino') {
        this._addEdge(endId, startId)
        break
      }
      pending = [{ from: endId }]
    }

    // その他の関数: それぞれ独立したサブグラフとして展開
    for (const funcNode of otherFuncs) {
      const name    = this._getFuncName(funcNode)
      const startId = `${name}_start`
      const endId   = `${name}_end`

      this._addNode(startId, 'function_start', name, name)
      const exits = this._processFunctionBody(funcNode, name, startId)
      this._addNode(endId, 'end', '終了', name)
      this._connectAll(exits, endId)
    }

    return this.graph
  }

  // -------------------------------------------------------
  // 関数ノードの収集・分類
  // -------------------------------------------------------

  /** 言語に応じて関数定義ノードを収集する */
  _findFuncNodes(root) {
    if (this.language === 'csharp') {
      // C#: namespace/class の中に入れ子になっているので再帰探索
      const results = []
      const traverse = (node) => {
        for (const child of node.children) {
          if (child.type === 'method_declaration') {
            results.push(child)
          } else {
            traverse(child)
          }
        }
      }
      traverse(root)
      return results
    }
    // C / C++ / ino: トップレベルの function_definition
    return root.children.filter(n => n.type === 'function_definition')
  }

  /** 言語に応じてメイン関数とその他に分類する */
  _splitFunctions(funcNodes) {
    if (this.language === 'ino') {
      // Arduino: setup → loop の順で接続
      const MAIN  = ['setup', 'loop']
      const setup = funcNodes.find(n => this._getFuncName(n) === 'setup')
      const loop  = funcNodes.find(n => this._getFuncName(n) === 'loop')
      return {
        mainFuncs:  [setup, loop].filter(Boolean),
        otherFuncs: funcNodes.filter(n => !MAIN.includes(this._getFuncName(n))),
      }
    }
    // C / C++: main()、C#: Main() をエントリとする
    const entryName = this.language === 'csharp' ? 'Main' : 'main'
    const entry = funcNodes.find(n => this._getFuncName(n) === entryName)
    return {
      mainFuncs:  [entry].filter(Boolean),
      otherFuncs: funcNodes.filter(n => this._getFuncName(n) !== entryName),
    }
  }

  /** 関数定義ノードから関数名を取得する */
  _getFuncName(funcNode) {
    if (this.language === 'csharp') {
      // method_declaration: name フィールドが identifier
      return funcNode.childForFieldName('name')?.text ?? 'unknown'
    }
    // C / C++ / ino: function_definition → declarator → function_declarator → declarator
    const declarator = funcNode.childForFieldName('declarator')
    if (!declarator) return 'unknown'
    if (declarator.type === 'function_declarator') {
      const nameNode = declarator.childForFieldName('declarator')
      if (nameNode) return nameNode.text
    }
    const m = declarator.text.match(/^(\w+)\s*\(/)
    return m ? m[1] : declarator.text
  }

  _processFunctionBody(funcNode, name, startId) {
    const body      = funcNode.childForFieldName('body')
    const bodyStmts = body ? body.children : []
    return this._processStatements(bodyStmts, name, [{ from: startId }])
  }

  // -------------------------------------------------------
  // 文リストの処理
  // pending: [{from: nodeId, label?: string}]
  // -------------------------------------------------------

  _processStatements(stmts, scope, pending) {
    let cur = pending
    for (const stmt of stmts) {
      if (!stmt.isNamed) continue
      cur = this._processStatement(stmt, scope, cur)
    }
    return cur
  }

  _processStatement(node, scope, pending) {
    switch (node.type) {
      case 'expression_statement':       return this._processExpr(node, scope, pending)
      case 'declaration':                return this._processDecl(node, scope, pending)
      case 'local_declaration_statement':return this._processDecl(node, scope, pending)  // C#
      case 'if_statement':               return this._processIf(node, scope, pending)
      case 'for_statement':              return this._processFor(node, scope, pending)
      case 'foreach_statement':          return this._processForeach(node, scope, pending) // C#
      case 'while_statement':            return this._processWhile(node, scope, pending)
      case 'do_statement':               return this._processDo(node, scope, pending)
      case 'return_statement':           return this._processReturn(node, scope, pending)
      case 'compound_statement':         return this._processStatements(node.children, scope, pending)
      case 'block':                      return this._processStatements(node.children, scope, pending) // C#
      default:                           return pending
    }
  }

  // -------------------------------------------------------
  // 各文の処理
  // -------------------------------------------------------

  _processExpr(node, scope, pending) {
    const label = node.text.replace(/;\s*$/, '').trim()
    if (!label) return pending
    const id = this._newId(scope)
    this._addNode(id, 'process', label, scope)
    this._connectAll(pending, id)
    return [{ from: id }]
  }

  _processDecl(node, scope, pending) {
    const label = node.text.replace(/;\s*$/, '').trim()
    if (!label) return pending
    const id = this._newId(scope)
    this._addNode(id, 'process', label, scope)
    this._connectAll(pending, id)
    return [{ from: id }]
  }

  // if (cond) { ... } else { ... }
  _processIf(node, scope, pending) {
    const condNode = node.childForFieldName('condition')
    const condText = condNode ? this._stripParens(condNode.text) : '条件'

    const decId = this._newId(scope, 'if')
    this._addNode(decId, 'decision', condText, scope)
    this._connectAll(pending, decId)

    // true ブランチ
    const consequence = node.childForFieldName('consequence')
    const trueExits = consequence
      ? this._processStatements(this._blockChildren(consequence), scope, [{ from: decId, label: 'Yes' }])
      : [{ from: decId, label: 'Yes' }]

    // false ブランチ
    const alternative = node.childForFieldName('alternative')
    let falseExits
    if (alternative) {
      const elseBody = alternative.type === 'else_clause' ? alternative.child(1) : alternative
      falseExits = elseBody
        ? this._processStatements(this._blockChildren(elseBody), scope, [{ from: decId, label: 'No' }])
        : [{ from: decId, label: 'No' }]
    } else {
      falseExits = [{ from: decId, label: 'No' }]
    }

    return [...trueExits, ...falseExits]
  }

  // for (init; cond; update) { body }
  _processFor(node, scope, pending) {
    let cur = pending

    const initNode = node.childForFieldName('initializer')
    if (initNode) {
      const initText = initNode.text.replace(/;\s*$/, '').trim()
      if (initText) {
        const initId = this._newId(scope, 'for_init')
        this._addNode(initId, 'process', initText, scope)
        this._connectAll(cur, initId)
        cur = [{ from: initId }]
      }
    }

    const condNode = node.childForFieldName('condition')
    const condText = condNode ? condNode.text.replace(/;\s*$/, '').trim() : 'for'
    const decId = this._newId(scope, 'for')
    this._addNode(decId, 'decision', condText || 'for', scope)
    this._connectAll(cur, decId)

    const body = node.childForFieldName('body')
    if (body) {
      const bodyExits = this._processStatements(this._blockChildren(body), scope, [{ from: decId, label: 'Yes' }])
      this._connectAll(bodyExits, decId)
    } else {
      this._addEdge(decId, decId, 'Yes')
    }

    return [{ from: decId, label: 'No' }]
  }

  // foreach (var x in collection) { body }  ← C# のみ
  _processForeach(node, scope, pending) {
    const left  = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const condText = (left && right)
      ? `${left.text} in ${right.text}`
      : (node.text.match(/foreach\s*\(([^)]+)\)/)?.[1] ?? 'foreach')

    const decId = this._newId(scope, 'foreach')
    this._addNode(decId, 'decision', condText, scope)
    this._connectAll(pending, decId)

    const body = node.childForFieldName('body')
    if (body) {
      const bodyExits = this._processStatements(this._blockChildren(body), scope, [{ from: decId, label: 'Yes' }])
      this._connectAll(bodyExits, decId)
    } else {
      this._addEdge(decId, decId, 'Yes')
    }

    return [{ from: decId, label: 'No' }]
  }

  // while (cond) { body }
  _processWhile(node, scope, pending) {
    const condNode = node.childForFieldName('condition')
    const condText = condNode ? this._stripParens(condNode.text) : 'while条件'

    const decId = this._newId(scope, 'while')
    this._addNode(decId, 'decision', condText, scope)
    this._connectAll(pending, decId)

    const body = node.childForFieldName('body')
    if (body) {
      const bodyExits = this._processStatements(this._blockChildren(body), scope, [{ from: decId, label: 'Yes' }])
      this._connectAll(bodyExits, decId)
    } else {
      this._addEdge(decId, decId, 'Yes')
    }

    return [{ from: decId, label: 'No' }]
  }

  // do { body } while (cond)
  _processDo(node, scope, pending) {
    const bodyStartId = this._newId(scope, 'do_body')
    this._addNode(bodyStartId, 'process', 'do', scope)
    this._connectAll(pending, bodyStartId)

    const body = node.childForFieldName('body')
    const bodyExits = body
      ? this._processStatements(this._blockChildren(body), scope, [{ from: bodyStartId }])
      : [{ from: bodyStartId }]

    const condNode = node.childForFieldName('condition')
    const condText = condNode ? this._stripParens(condNode.text) : 'while条件'

    const decId = this._newId(scope, 'do_while')
    this._addNode(decId, 'decision', condText, scope)
    this._connectAll(bodyExits, decId)
    this._addEdge(decId, bodyStartId, 'Yes')

    return [{ from: decId, label: 'No' }]
  }

  _processReturn(node, scope, pending) {
    const label = node.text.replace(/;\s*$/, '').trim()
    const id = this._newId(scope, 'return')
    this._addNode(id, 'process', label, scope)
    this._connectAll(pending, id)
    return [{ from: id }]
  }

  // -------------------------------------------------------
  // ユーティリティ
  // -------------------------------------------------------

  _blockChildren(node) {
    // C/C++: compound_statement、C#: block
    return (node.type === 'compound_statement' || node.type === 'block')
      ? node.children
      : [node]
  }

  _connectAll(pending, targetId) {
    for (const p of pending) this._addEdge(p.from, targetId, p.label)
  }

  _newId(scope, kind = '') {
    const key   = `${scope}_${kind}`
    const count = (this._counters.get(key) ?? -1) + 1
    this._counters.set(key, count)
    return kind ? `${scope}_${kind}_${count}` : `${scope}_${count}`
  }

  _addNode(id, type, label, func = null) {
    if (!this.graph.nodes.has(id)) {
      this.graph.nodes.set(id, { type, label, func })
      if (func) {
        if (!this.graph.funcGroups.has(func)) this.graph.funcGroups.set(func, [])
        this.graph.funcGroups.get(func).push(id)
      }
    }
  }

  _addEdge(from, to, label) {
    this.graph.edges.push({ from, to, ...(label !== undefined ? { label } : {}) })
  }

  _stripParens(text) {
    return text.replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim()
  }
}
