export type Todo = {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

declare module 'claude-code' {
  interface PluginState {
    'todo-tree': { todos: Todo[]; sessionId: string | null }
  }
}
