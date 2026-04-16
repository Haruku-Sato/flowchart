#!/usr/bin/env node
// node_modules から public/ へ必要なファイルをコピーする

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

const copies = [
  // WASM ランタイム
  {
    src: path.join(root, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
    dest: path.join(root, 'public/wasm/tree-sitter.wasm'),
  },
  // グラマー WASM (tree-sitter-wasms パッケージから取得)
  {
    src: path.join(root, 'node_modules/tree-sitter-wasms/out/tree-sitter-cpp.wasm'),
    dest: path.join(root, 'public/wasm/tree-sitter-cpp.wasm'),
  },
  {
    src: path.join(root, 'node_modules/tree-sitter-wasms/out/tree-sitter-c.wasm'),
    dest: path.join(root, 'public/wasm/tree-sitter-c.wasm'),
  },
  {
    src: path.join(root, 'node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm'),
    dest: path.join(root, 'public/wasm/tree-sitter-c_sharp.wasm'),
  },
  // web-tree-sitter JS ランタイム
  {
    src: path.join(root, 'node_modules/web-tree-sitter/tree-sitter.js'),
    dest: path.join(root, 'public/js/vendor/tree-sitter.js'),
  },
]

// ELK dist ディレクトリをまるごとコピー（チャンクファイルが含まれるため）
const elkSrc  = path.join(root, 'node_modules/@mermaid-js/layout-elk/dist')
const elkDest = path.join(root, 'public/js/vendor/layout-elk')

for (const { src, dest } of copies) {
  if (!fs.existsSync(src)) {
    console.error(`ERROR: source not found: ${src}`)
    console.error('npm install を先に実行してください。')
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  console.log(`Copied: ${path.relative(root, src)} → ${path.relative(root, dest)}`)
}

// ELK ディレクトリを再帰的にコピー
if (!fs.existsSync(elkSrc)) {
  console.error(`ERROR: ELK source not found: ${elkSrc}`)
  console.error('npm install を先に実行してください。')
  process.exit(1)
}
copyDirSync(elkSrc, elkDest)
console.log(`Copied: node_modules/@mermaid-js/layout-elk/dist → public/js/vendor/layout-elk/`)

console.log('ファイルのコピーが完了しました。')

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(s, d)
    } else {
      fs.copyFileSync(s, d)
    }
  }
}
