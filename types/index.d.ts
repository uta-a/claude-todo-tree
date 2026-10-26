export type Todo = {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
  // set_todos で渡された親の見出し。あれば 2 層で表示する
  group?: string
}

declare module 'claude-code' {
  interface PluginState {
    'todo-tree': { todos: Todo[]; sessionId: string | null }
  }
}
