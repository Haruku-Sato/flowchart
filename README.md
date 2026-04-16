# Arduino Flowchart Generator

Arduino (.ino) / C++ / C / C# のソースコードからフローチャートを自動生成する Web アプリです。

## 機能

- **ファイル対応**: `.ino` / `.cpp` / `.c` / `.cs` をドラッグ&ドロップまたは選択
- **コード直接入力**: テキストエリアにコードを貼り付けて生成（言語自動検出あり）
- **関数ごとの表示切り替え**: 全体表示 / 任意の関数を単独表示
- **エクスポート**:
  - SVG ダウンロード
  - PNG ダウンロード
  - draw.io (.drawio) ダウンロード
- **Arduino 対応**: `setup()` → `loop()` のループ構造を正しく表現
- **ELK レイアウト**: ループバック辺を含む複雑なグラフにも対応

## 対応言語

| 拡張子 | 言語 |
|--------|------|
| `.ino` | Arduino (C++) |
| `.cpp` | C++ |
| `.c`   | C |
| `.cs`  | C# |

## セットアップ

```bash
npm install
npm run setup   # WASM ファイルをコピー
npm start       # http://localhost:3000 で起動
```

または開発用に1コマンドで:

```bash
npm run dev
```

## 使い方

1. ブラウザで `http://localhost:3000` を開く
2. **ファイルタブ**: `.ino` などのファイルをドラッグ&ドロップ（またはファイル選択ボタン）
3. **コード入力タブ**: コードを直接貼り付けて「生成」ボタンをクリック
4. フローチャートが表示されたら SVG / PNG / draw.io 形式でダウンロード可能

## 技術スタック

- [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) — AST パース
- [Mermaid](https://mermaid.js.org/) — フローチャート描画
- [@mermaid-js/layout-elk](https://github.com/mermaid-js/layout-elk) — ELK レイアウトエンジン
- Vanilla JS (ES Modules) / HTML / CSS — フレームワークなし

## ディレクトリ構成

```
arduino-flowchart/
├── public/
│   ├── index.html          # アプリ本体
│   ├── js/
│   │   ├── main.js         # UI・イベント統合エントリーポイント
│   │   ├── parser.js       # tree-sitter 初期化・言語自動検出
│   │   ├── analyzer.js     # AST → FlowGraph 変換
│   │   ├── generator.js    # FlowGraph → Mermaid コード生成
│   │   ├── exporter.js     # SVG / PNG エクスポート
│   │   ├── drawio.js       # draw.io エクスポート
│   │   └── vendor/         # バンドル済みライブラリ
│   └── wasm/               # tree-sitter の文法 WASM ファイル
└── scripts/
    └── copy-wasm.js        # node_modules から wasm をコピーするスクリプト
```
