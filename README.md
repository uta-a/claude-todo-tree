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
- サブエージェントの TODO は表示しない
- すべて完了すると表示を消す

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
