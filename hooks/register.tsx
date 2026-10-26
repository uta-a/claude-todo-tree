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

// TodoWrite / set_todos の todos 入力を検証して Todo[] にする。不正なら理由を返す
const parseList = (raw: unknown): Todo[] | string => {
  if (!Array.isArray(raw)) {
    return 'todos must be an array'
  }
  const list: Todo[] = []
  for (const [i, t] of raw.entries()) {
    const { content, status } = (t ?? {}) as { content?: unknown; status?: unknown }
    if (typeof content !== 'string' || !STATUSES.includes(status as Todo['status'])) {
      return `todos[${i}] needs a string content and a status of ${STATUSES.join(', ')}`
    }
    list.push({ id: String(i), text: content, status: status as Todo['status'] })
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
        'Replace the TODO list shown above the prompt. Pass the whole list every time, with the current status of every item.',
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

  on('tool.call', { tool: /^mcp__todo-tree__set_todos$/ }, async ($, e) => {
    const list = parseList((e as { todos?: unknown }).todos)
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

    return (
      <Box flexDirection="column">
        <Text bold>
          TODO <Text dimColor>· {done}/{list.length}</Text>
        </Text>
        {list.map((t, i) => (
          <Text key={t.id}>
            <Text dimColor>{i === list.length - 1 ? '└─ ' : '├─ '}</Text>
            {t.status === 'completed' ? (
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
            )}
          </Text>
        ))}
      </Box>
    )
  })
}
