import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const SET_TODOS = 'mcp__todo-tree__set_todos'
// 調査 2/2 完了、実装 1/3 で 1 件作業中、テスト 0/2、グループなし 1 件
const TODOS = [
  { content: '要件を読む', status: 'completed', group: '調査' },
  { content: '既存実装を読む', status: 'completed', group: '調査' },
  { content: 'データ構造を決める', status: 'completed', group: '実装' },
  { content: '描画を書く', status: 'in_progress', group: '実装' },
  { content: '保存を書く', status: 'pending', group: '実装' },
  { content: '単体テスト', status: 'pending', group: 'テスト' },
  { content: '結合テスト', status: 'pending', group: 'テスト' },
  { content: 'README を更新する', status: 'pending' },
]
const BAND = {
  plugin: 'todo-tree',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 40,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const LINES = [
  'TODO · 3/8',
  '├─ 調査 · 2/2',
  '├─ 実装 · 1/3',
  '│  ├─ ☑︎ データ構造を決める',
  '│  ├─ ▶︎ 描画を書く',
  '│  └─ ☐ 保存を書く',
  '├─ テスト · 0/2',
  '└─ ☐ README を更新する',
]

type El = { type: string; props?: Record<string, unknown>; children?: unknown[] }

const isEl = (c: unknown): c is El => typeof c === 'object' && c !== null && 'type' in c

const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : isEl(c) ? (c.children ?? []).map(textOf).join('') : ''

// Box の直下にある Text を 1 行として集める
const rowsOf = (el: El): El[] =>
  (el.children ?? []).flatMap(c =>
    !isEl(c) ? [] : c.type === 'Text' ? [c] : c.type === 'Box' ? rowsOf(c) : [],
  )

const seed = async (...[$, on]: Parameters<TestBody>) => {
  on('session.id' as never, (() => ({ value: 's1' })) as never)
  on('session.messages' as never, (() => ({ value: [] })) as never)
  await $.tool.call({ tool: SET_TODOS, todos: TODOS } as never)
}

test('ターミナルではツリーの各行の文字列が変わらない', async ($, on) => {
  await seed($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = rowsOf((await ui.drawn()) as El)
  expect(rows.map(textOf)).toEqual(LINES)
  await ui.unmount()
})

test('VS Code では罫線がそろうよう、すべての行を等幅で描く', async ($, on) => {
  await seed($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const rows = rowsOf((await ui.drawn()) as El)
  expect(rows.map(textOf)).toEqual(LINES)
  expect(rows.map(r => r.props?.mono)).toEqual(LINES.map(() => true))
  await ui.unmount()
})

// 文字列を子に持つ Text のうち、文字列が条件に合うものを集める
const textsWith = (c: unknown, match: (s: string) => boolean): El[] =>
  !isEl(c)
    ? []
    : [
        ...(c.type === 'Text' && (c.children ?? []).some(s => typeof s === 'string' && match(s))
          ? [c]
          : []),
        ...(c.children ?? []).flatMap(x => textsWith(x, match)),
      ]

test('完了した項目とグループ名は色を付けず、灰色（dim）と取り消し線で描く', async ($, on) => {
  await seed($, on)
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const done = textsWith(await ui.drawn(), s => s === '調査' || s.startsWith('☑︎'))
    expect(done).toHaveLength(2)
    for (const t of done) {
      expect(t.props?.color).toBeUndefined()
      expect(t.props?.dimColor).toBe(true)
      expect(t.props?.strikethrough).toBe(true)
    }
    await ui.unmount()
  }
})

test('Claude のアプリ（desktop / mobile）では TODO tree を描かない', async ($, on) => {
  await seed($, on)
  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(textOf(await ui.drawn())).not.toContain('TODO')
    await ui.unmount()
  }
})
