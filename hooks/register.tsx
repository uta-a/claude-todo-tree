import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Todo } from '../types'

const todos = atom({ plugin: 'todo-tree', key: 'todos' } as const, [] as Todo[])
// todos がどのセッションのものか。resume で別セッションに切り替わったら読み直す
const owner = atom({ plugin: 'todo-tree', key: 'sessionId' } as const, null as string | null)

// U+FE0E で絵文字ではなく文字として表示させる
const MARK = { pending: '☐', in_progress: '▶︎', completed: '☑︎' } as const
const STATUSES = ['pending', 'in_progress', 'completed'] as const
const SET_TODOS = 'mcp__todo-tree__set_todos'
const AUTO_SHOW = `# TODO tree

When you start implementation work of more than one step in the main conversation, call ${SET_TODOS} before your first edit, listing the steps. Use it in preference to any other TODO tool. Group the steps with group when they fall into phases. Call it again whenever a step starts or finishes, so the list stays current. Skip it for questions, research, and single small edits. Subagents do not call it.`

// TodoWrite / set_todos の todos 入力を検証して Todo[] にする。不正なら理由を返す
const parseList = (raw: unknown): Todo[] | string => {
  if (!Array.isArray(raw)) {
    return 'todos must be an array'
  }
  const list: Todo[] = []
  for (const [i, t] of raw.entries()) {
    const { content, status, group } = (t ?? {}) as {
      content?: unknown
      status?: unknown
      group?: unknown
    }
    if (typeof content !== 'string' || !STATUSES.includes(status as Todo['status'])) {
      return `todos[${i}] needs a string content and a status of ${STATUSES.join(', ')}`
    }
    if (group !== undefined && typeof group !== 'string') {
      return `todos[${i}].group must be a string`
    }
    const todo: Todo = { id: String(i), text: content, status: status as Todo['status'] }
    list.push(group ? { ...todo, group } : todo)
  }
  return list
}

const updateTask = (
  list: Todo[],
  taskId: string,
  subject: string | undefined,
  status: Todo['status'] | 'deleted' | undefined,
): Todo[] =>
  status === 'deleted'
    ? list.filter(t => t.id !== taskId)
    : list.map(t =>
        t.id === taskId ? { ...t, text: subject ?? t.text, status: status ?? t.status } : t,
      )

type Node = { kind: 'item'; todo: Todo } | { kind: 'group'; name: string; items: Todo[] }

// group を持つ項目を、最初に現れた位置で 1 つの親にまとめる
const toTree = (list: Todo[]): Node[] => {
  const nodes: Node[] = []
  const groups = new Map<string, Todo[]>()
  for (const todo of list) {
    if (todo.group === undefined) {
      nodes.push({ kind: 'item', todo })
      continue
    }
    const items = groups.get(todo.group)
    if (items) {
      items.push(todo)
    } else {
      const created = [todo]
      groups.set(todo.group, created)
      nodes.push({ kind: 'group', name: todo.group, items: created })
    }
  }
  return nodes
}

// 子を展開する親。作業中の項目を含む親、なければ最初の未完了の親
const activeGroup = (nodes: Node[]): string | undefined => {
  const groups = nodes.flatMap(n => (n.kind === 'group' ? [n] : []))
  return (
    groups.find(g => g.items.some(t => t.status === 'in_progress')) ??
    groups.find(g => g.items.some(t => t.status !== 'completed'))
  )?.name
}

// 会話の記録にある TODO ツールの呼び出しを順に再生して、今の TODO を組み立てる
const replay = async ($: EngineInterface): Promise<Todo[]> => {
  let list: Todo[] = []
  for (const message of await $.session.messages()) {
    for (const use of message.toolUses ?? []) {
      if (use.isError || use.result === undefined) {
        continue
      }
      const input = use.input as Record<string, unknown>
      if (use.tool === 'TodoWrite' || use.tool === SET_TODOS) {
        const parsed = parseList(input.todos)
        if (typeof parsed !== 'string') {
          list = parsed
        }
      } else if (use.tool === 'TaskCreate') {
        const id = (use.result as { task?: { id?: unknown } }).task?.id
        if (typeof id === 'string' && typeof input.subject === 'string') {
          list = [...list, { id, text: input.subject, status: 'pending' }]
        }
      } else if (use.tool === 'TaskUpdate' && typeof input.taskId === 'string') {
        list = updateTask(
          list,
          input.taskId,
          typeof input.subject === 'string' ? input.subject : undefined,
          input.status as Todo['status'] | 'deleted' | undefined,
        )
      }
    }
  }
  return list
}

const save = async ($: EngineInterface, change: (list: Todo[]) => Todo[]) => {
  const sessionId = await $.session.id()
  // 別セッションの state が残っていたら、記録から復元した TODO を土台にする
  const base = (await read($, owner)) === sessionId ? null : await replay($)
  await update($, todos, list => change(base ?? list))
  await update($, owner, () => sessionId)
}

export const register: Register = on => {
  // 描画中は state に書けないので、別セッションの state しかないときの再生結果をここに持つ
  const replayed = new Map<string, Todo[]>()

  // TodoWrite が使えないセッション向けに、TODO を丸ごと置き換えるツールを出す
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'set_todos',
      description:
        'Replace the TODO list shown above the prompt. Pass the whole list every time, with the current status of every item. Give items the same group to show them under one parent heading; only the group being worked on is expanded.',
      inputSchema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                status: { type: 'string', enum: [...STATUSES] },
                group: { type: 'string' },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
      isDeferred: false,
    })
    // resume したセッションでは記録から TODO を復元する
    const list = await replay($)
    const sessionId = await $.session.id()
    await update($, todos, () => list)
    await update($, owner, () => sessionId)
    return next(e)
  })

  // 実装を始めるときに、モデルが自分から TODO を出すように指示する
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    if (!e.tools.includes(SET_TODOS)) {
      return { sections }
    }
    return { sections: [...sections, { id: 'todo-tree:auto-show', text: AUTO_SHOW, scope: 'session' }] }
  })

  on('tool.call', { tool: /^mcp__todo-tree__set_todos$/ }, async ($, e) => {
    const { todos: raw, agentId } = e as { todos?: unknown; agentId?: string }
    // サブエージェントの TODO は無視し、メインの会話のものだけ表示する
    if (agentId !== undefined) {
      return { result: 'TODO list is only for the main conversation; nothing changed' }
    }
    const list = parseList(raw)
    if (typeof list === 'string') {
      return { deny: list }
    }
    await save($, () => list)
    const done = list.filter(t => t.status === 'completed').length
    return { result: `TODO updated: ${done}/${list.length} completed` }
  })

  // サブエージェントの TODO は無視し、メインの会話のものだけ表示する
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && !ran.isError) {
      await save($, () =>
        e.todos.map((t, i) => ({ id: String(i), text: t.content, status: t.status })),
      )
    }
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && !ran.isError) {
      const { id } = ran.result.task
      const todo: Todo = { id, text: e.subject, status: 'pending' }
      await save($, list => [...list, todo])
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && !ran.isError) {
      const { taskId, subject, status } = e
      await save($, list => updateTask(list, taskId, subject, status))
    }
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const sessionId = await $.session.id()
    let list = await read($, todos)
    if ((await read($, owner)) !== sessionId) {
      list = replayed.get(sessionId) ?? (await replay($))
      replayed.set(sessionId, list)
    }
    const done = list.filter(t => t.status === 'completed').length

    if (e.props.hasSurvey || list.length === 0 || done === list.length) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    const label = (t: Todo) =>
      t.status === 'completed' ? (
        <Text color="success" dimColor strikethrough>
          {MARK.completed} {t.text}
        </Text>
      ) : t.status === 'in_progress' ? (
        <Text color="claude" bold>
          {MARK.in_progress} {t.text}
        </Text>
      ) : (
        <Text>
          {MARK.pending} {t.text}
        </Text>
      )

    const nodes = toTree(list)
    const active = activeGroup(nodes)

    return (
      <Box flexDirection="column">
        <Text bold>
          TODO <Text dimColor>· {done}/{list.length}</Text>
        </Text>
        {nodes.map((n, i) => {
          const last = i === nodes.length - 1
          const branch = <Text dimColor>{last ? '└─ ' : '├─ '}</Text>
          if (n.kind === 'item') {
            return (
              <Text key={n.todo.id}>
                {branch}
                {label(n.todo)}
              </Text>
            )
          }
          const groupDone = n.items.filter(t => t.status === 'completed').length
          const count = (
            <Text dimColor>
              {' '}
              · {groupDone}/{n.items.length}
            </Text>
          )
          return (
            <Box key={`group:${n.name}`} flexDirection="column">
              <Text>
                {branch}
                {groupDone === n.items.length ? (
                  <Text color="success" dimColor strikethrough>
                    {n.name}
                  </Text>
                ) : n.name === active ? (
                  <Text color="claude" bold>
                    {n.name}
                  </Text>
                ) : (
                  <Text>{n.name}</Text>
                )}
                {count}
              </Text>
              {n.name === active &&
                n.items.map((t, j) => (
                  <Text key={t.id}>
                    <Text dimColor>
                      {last ? '   ' : '│  '}
                      {j === n.items.length - 1 ? '└─ ' : '├─ '}
                    </Text>
                    {label(t)}
                  </Text>
                ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
