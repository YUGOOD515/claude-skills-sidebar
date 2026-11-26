export type SkillInfo = {
  name: string
  description: string
  manualOnly: boolean
  path: string
}

export type PluginInfo = {
  id: string
  name: string
  marketplace: string
  version: string
  enabled: boolean
  skills: SkillInfo[]
  commands: number
  agents: number
  hasHooks: boolean
  hasMcp: boolean
  /** local: installed_plugins.json; synced: claude.ai sync folder; builtin: Anthropic built-ins; account: seen loaded, origin unknown */
  source: 'local' | 'synced' | 'builtin' | 'account'
  /** Seen in this session's command list (or an enabled local plugin with no commands). */
  loaded: boolean
}

export type OpenRow = { key: string; phase: number }

export type Inventory = {
  scannedAt: number
  skills: SkillInfo[]
  plugins: PluginInfo[]
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'skills-sidebar': {
      inventory: Shaped<Inventory | null>
      open: Shaped<OpenRow | null>
    }
  }
}
