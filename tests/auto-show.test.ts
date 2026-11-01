import { expect, test } from 'claude-code/testing'

const SET_TODOS = 'mcp__todo-tree__set_todos'
const ID = 'todo-tree:auto-show'
const FACTS = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: [],
  outputStyle: null,
  traits: [],
}
const TODOS = [{ content: 'a', status: 'pending' }]

test('set_todos があるときだけ指示を足す', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' }] }))
  const withTool = await $.prompt.compose({ ...FACTS, tools: [SET_TODOS] })
  expect(withTool.sections.at(-1)?.id).toBe(ID)
  const without = await $.prompt.compose({ ...FACTS, tools: [] })
  expect(without.sections.some(s => s.id === ID)).toBe(false)
})

test('サブエージェントの set_todos は TODO を更新しない', async ($, on) => {
  on('session.id' as never, (() => ({ value: 's1' })) as never)
  on('session.messages' as never, (() => ({ value: [] })) as never)
  const sub = await $.tool.call({ tool: SET_TODOS, todos: TODOS, agentId: 'a1' } as never)
  expect(JSON.stringify(sub)).toContain('nothing changed')
  const main = await $.tool.call({ tool: SET_TODOS, todos: TODOS } as never)
  expect(JSON.stringify(main)).toContain('TODO updated')
})
