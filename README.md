# todo-tree

Claude Code の TODO をプロンプトの上にツリー表示する mod。

```
TODO · 1/3
├─ ☑︎ 調査
├─ ▶︎ 実装
└─ ☐ テスト
```

- TodoWrite / TaskCreate / TaskUpdate の呼び出しを拾って表示する
- TodoWrite が使えないセッション向けに `set_todos` ツールを追加する
- resume したセッションでは会話の記録から TODO を復元する
- `set_todos` の項目に `group` を付けると親の見出しの下にまとめ、作業中の親だけ子を展開する
- 複数ステップの実装を始めるとき、モデルが自分から `set_todos` で TODO を出すようシステムプロンプトに指示を足す
- サブエージェントの TODO は表示しない
- Claude のアプリ（デスクトップ・スマホ）では表示しない。ターミナルと VS Code でだけ表示する
- すべて完了しても、次に新しい TODO が来るまで表示を残す

## インストール

ターミナルの Claude Code のプロンプトで:

```
/plugin install todo-tree --marketplace uta-a/claude-todo-tree
```

マーケットプレイスの追加を聞かれたら `y`、続けてスコープを選ぶ。

シェルからは:

```
claude plugin install todo-tree --marketplace uta-a/claude-todo-tree
```

## 開発

テストは Claude Code のプラグイン用ランナーで実行する。`tests/*.test.ts` は `claude-code/testing` を import しており、このモジュールはランナーが用意するので、`bun test` などでは解決できずに失敗する。

```
claude plugin test .
claude plugin validate .
```
