import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Inventory, OpenRow, PluginInfo, SkillInfo } from '../types'

const PANE = 'skills-sidebar'
const TITLE = '我的能力'
// The Claude config folder (~/.claude), found from where this plugin lives so it
// works for whoever installs it: its own folder, else its data folder.
const claudeDir = async ($: any): Promise<string> => {
  const pick = (p: string | undefined) => {
    const s = String(p ?? '').replace(/\\/g, '/')
    const i = s.toLowerCase().lastIndexOf('/.claude/')
    return i >= 0 ? s.slice(0, i + '/.claude'.length) : ''
  }
  const fromRoot = pick($.plugin.root)
  if (fromRoot) return fromRoot
  const env = await $.process.hookEnv()
  const fromData = pick(env.CLAUDE_PLUGIN_DATA)
  if (fromData) return fromData
  throw new Error('找不到 ~/.claude 文件夹')
}

const inventory = atom({ plugin: 'skills-sidebar', key: 'inventory' } as const, null, {
  shape: 'inventory-2',
})
const openRow = atom({ plugin: 'skills-sidebar', key: 'open' } as const, null as OpenRow | null, {
  shape: 'open-1',
})

const unquote = (s: string) => {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

// Reads the YAML frontmatter of a SKILL.md: name, description, disable-model-invocation.
const parseSkill = (text: string, fallbackName: string, path: string): SkillInfo => {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const lines = (m?.[1] ?? '').split(/\r?\n/)
  const fields: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = (lines[i] ?? '').match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1] ?? ''
    let value = kv[2] ?? ''
    if (value === '>' || value === '|' || value === '>-' || value === '|-' || value === '') {
      const more: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? '')) more.push((lines[++i] ?? '').trim())
      value = more.join(' ')
    }
    fields[key] = unquote(value)
  }
  return {
    name: fields.name || fallbackName,
    description: fields.description || '（没有描述）',
    manualOnly: fields['disable-model-invocation'] === 'true',
    path,
  }
}

const scanSkillDir = async ($: any, dir: string): Promise<SkillInfo[]> => {
  if (!(await $.fs.exists(dir))) return []
  const entries = await $.fs.list(dir)
  const out: SkillInfo[] = []
  for (const ent of entries) {
    // A junction or symlink lists as `other` with `isLink`; the SKILL.md check below settles it.
    const isDirLike = ent.kind === 'dir' || (ent.kind === 'other' && ent.isLink)
    if (!isDirLike || ent.name === 'synced' || ent.name.startsWith('.')) continue
    const file = `${dir}/${ent.name}/SKILL.md`
    if (!(await $.fs.exists(file))) continue
    try {
      out.push(parseSkill(await $.fs.read(file), ent.name, file))
    } catch {
      out.push({ name: ent.name, description: '（SKILL.md 读取失败）', manualOnly: false, path: file })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const countDir = async ($: any, dir: string, ext?: string) => {
  if (!(await $.fs.exists(dir))) return 0
  const entries = await $.fs.list(dir)
  return entries.filter((e: { name: string; kind: string }) => (ext ? e.kind === 'file' && e.name.endsWith(ext) : true)).length
}

const readJson = async ($: any, path: string): Promise<any> => {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

const scan = async ($: any): Promise<Inventory> => {
  const home = await claudeDir($)
  const skills = await scanSkillDir($, `${home}/skills`)
  const installed = await readJson($, `${home}/plugins/installed_plugins.json`)
  const settings = await readJson($, `${home}/settings.json`)
  const enabledMap: Record<string, boolean> = settings?.enabledPlugins ?? {}
  const plugins: PluginInfo[] = []
  for (const [id, records] of Object.entries<any>(installed?.plugins ?? {})) {
    const rec = Array.isArray(records) ? records[0] : records
    if (!rec) continue
    const root = String(rec.installPath ?? '').replace(/\\/g, '/')
    const [name = id, marketplace = ''] = id.split('@')
    plugins.push({
      id,
      name,
      marketplace,
      version: String(rec.version ?? ''),
      enabled: enabledMap[id] === true,
      skills: root ? await scanSkillDir($, `${root}/skills`) : [],
      commands: root ? await countDir($, `${root}/commands`, '.md') : 0,
      agents: root ? await countDir($, `${root}/agents`, '.md') : 0,
      hasHooks: root ? await $.fs.exists(`${root}/hooks`) : false,
      hasMcp: root ? await $.fs.exists(`${root}/.mcp.json`) : false,
      source: 'local',
      loaded: false,
    })
  }

  // What this session actually loaded: every plugin skill or command is a slash command.
  // This is the only source for plugins enabled through the claude.ai account (Data, Design…).
  const syncedNames = await scanSyncedNames($, home)
  let cmds: { name: string; description: string; source: string; plugin?: string }[] = []
  try {
    cmds = await $.command.list()
  } catch {
    cmds = []
  }
  const groups = new Map<string, SkillInfo[]>()
  for (const c of cmds) {
    if (c.source !== 'plugin' || !c.plugin) continue
    const pname = c.plugin.split('@')[0] ?? c.plugin
    const short = c.name.startsWith(`${pname}:`) ? c.name.slice(pname.length + 1) : c.name
    const list = groups.get(pname) ?? []
    list.push({ name: short, description: c.description || '（没有描述）', manualOnly: false, path: '' })
    groups.set(pname, list)
  }
  for (const [pname, list] of groups) {
    const local = plugins.find(p => p.name === pname)
    if (local) {
      local.loaded = true
      if (local.skills.length === 0 && local.commands === 0) local.skills = list
      continue
    }
    const source = pname === 'anthropic-skills' ? 'builtin' : syncedNames.has(pname) ? 'synced' : 'account'
    plugins.push({
      id: pname,
      name: pname,
      marketplace: source === 'builtin' ? 'Anthropic 内置' : 'claude.ai 账号',
      version: '',
      enabled: true,
      skills: list.sort((a, b) => a.name.localeCompare(b.name)),
      commands: 0,
      agents: 0,
      hasHooks: false,
      hasMcp: false,
      source,
      loaded: true,
    })
  }
  // A local plugin with no slash commands (LSP, hooks only) never shows in the list; trust its switch.
  for (const p of plugins) if (p.source === 'local' && !p.loaded && p.enabled) p.loaded = true

  const order = { account: 0, synced: 0, local: 1, builtin: 2 } as const
  plugins.sort(
    (a, b) =>
      Number(b.loaded) - Number(a.loaded) || order[a.source] - order[b.source] || a.name.localeCompare(b.name),
  )
  return { scannedAt: Date.now(), skills, plugins }
}

// Names of plugins the claude.ai sync has downloaded (enabled or not), to label their source.
const scanSyncedNames = async ($: any, home: string): Promise<Set<string>> => {
  const names = new Set<string>()
  const root = `${home}/plugins/synced`
  if (!(await $.fs.exists(root))) return names
  for (const bucket of await $.fs.list(root)) {
    if (bucket.kind !== 'dir') continue
    for (const dir of await $.fs.list(`${root}/${bucket.name}`)) {
      if (dir.kind !== 'dir') continue
      const meta = await readJson($, `${root}/${bucket.name}/${dir.name}/.claude-plugin/plugin.json`)
      if (meta?.name) names.add(String(meta.name))
    }
  }
  return names
}

const rescan = async ($: any) => {
  try {
    const inv = await scan($)
    await update($, inventory, () => inv)
  } catch (err) {
    await update($, inventory, () => ({
      scannedAt: Date.now(),
      skills: [],
      plugins: [],
      error: String(err),
    }))
  }
}

const clock = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// Click a row to open its detail; click again (or another row) to close it.
const toggleRow = async ($: any, key: string) => {
  await update($, openRow, cur => (cur?.key === key ? null : { key, phase: 3 }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skills-sidebar',
      description: '在侧边面板列出所有已安装的个人 skill 和插件',
    })
    void rescan($)
    // Account plugins and MCP servers finish loading after start; look again shortly.
    void $.clock.after(4000, () => rescan($))
    return next(e)
  })

  // Silent: opens the pane and writes nothing to the transcript, so the model is not woken.
  on('command.run', { command: 'skills-sidebar' }, async $ => {
    void rescan($)
    await $.ui.open({ id: PANE, title: TITLE })
    return {}
  })

  // A one-line entry above the prompt: press it to open the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const inv = await read($, inventory)
    if (!inv) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Button key="open-skills-sidebar" plain dimColor onPress={() => $.ui.open({ id: PANE, title: TITLE })}>
          {TITLE}
          <Text dimColor>
            {'  '}
            {String(inv.skills.length)} skill · {String(inv.plugins.length)} 插件
          </Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const inv = await read($, inventory)
    const open = await read($, openRow)
    const refresh = () => rescan($)

    if (!inv) {
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          <Text dimColor>正在扫描…</Text>
          <Button key="refresh" onPress={refresh}>
            扫描
          </Button>
        </Box>
      )
    }

    const enabledCount = inv.plugins.filter(p => p.loaded).length
    const SOURCE_LABEL = { local: '本地', synced: '账号', account: '账号', builtin: '内置' } as const
    const linesFor = (phase: number) => (phase >= 3 ? undefined : phase === 2 ? 3 : 1)

    const stat = (value: number, label: string) => (
      <Box flexDirection="column">
        <Text size="title" weight="semibold" tabular>
          {String(value)}
        </Text>
        <Text size="caption" dimColor>
          {label}
        </Text>
      </Box>
    )

    const sectionHead = (title: string, count: number, hint: string) => (
      <Box flexDirection="column">
        <Box flexDirection="row" gap="xs">
          <Text size="heading" weight="semibold">
            {title}
          </Text>
          <Text size="heading" dimColor tabular>
            {String(count)}
          </Text>
        </Box>
        <Text size="caption" dimColor>
          {hint}
        </Text>
      </Box>
    )

    // Head line: chevron + name on the left (pressable), tag on the right.
    // Detail under it only while open, growing by phase.
    const row = (
      key: string,
      name: string,
      tag: RenderChildren,
      detail: (phase: number) => RenderChildren,
      dim = false,
    ) => {
      const phase = open?.key === key ? open.phase : 0
      return (
        <Box key={key} flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Button key={key} plain dimColor={dim} onPress={() => toggleRow($, key)}>
              {phase ? '▾ ' : '▸ '}
              <Text weight="medium">{name}</Text>
            </Button>
            {tag}
          </Box>
          {phase ? (
            <Box flexDirection="column" gap="xs" paddingLeft="md">
              {detail(phase)}
            </Box>
          ) : (
            ''
          )}
        </Box>
      )
    }

    const skillRow = (s: SkillInfo) =>
      row(
        `skill:${s.name}`,
        s.name,
        s.manualOnly ? (
          <Text size="caption" color="suggestion">
            手动 /{s.name}
          </Text>
        ) : (
          ''
        ),
        phase => (
          <Box flexDirection="column" gap="xs">
            <Text size="footnote" dimColor maxLines={linesFor(phase)}>
              {s.description}
            </Text>
            {phase >= 3 ? (
              <Text size="caption" dimColor mono wrap="truncate-middle">
                {s.path}
              </Text>
            ) : (
              ''
            )}
          </Box>
        ),
      )

    const pluginRow = (p: PluginInfo) => {
      const parts = [
        p.skills.length ? `${p.skills.length} skill` : '',
        p.commands ? `${p.commands} 命令` : '',
        p.agents ? `${p.agents} 智能体` : '',
        p.hasHooks ? '钩子' : '',
        p.hasMcp ? 'MCP' : '',
      ].filter(Boolean)
      const lines = [
        [p.marketplace, p.version, p.loaded ? '' : '未加载'].filter(Boolean).join(' · '),
        ...p.skills.map(s => `${s.name}：${s.description}`),
      ]
      return row(
        `plugin:${p.id}`,
        p.name,
        <Box flexDirection="row" gap="xs" alignItems="center">
          <Text size="caption" dimColor>
            {parts.join(' · ') || '语言服务'}
          </Text>
          <Text size="caption" dimColor>
            {SOURCE_LABEL[p.source]}
          </Text>
          <Text size="caption" color={p.loaded ? 'success' : 'inactive'}>
            {p.loaded ? '●' : '○'}
          </Text>
        </Box>,
        phase => (
          <Box flexDirection="column" gap="xs">
            {lines.slice(0, phase >= 3 ? lines.length : phase).map((line, i) => (
              <Text size={i === 0 ? 'caption' : 'footnote'} dimColor maxLines={linesFor(phase)}>
                {line}
              </Text>
            ))}
          </Box>
        ),
        !p.loaded,
      )
    }

    return (
      <Box flexDirection="column" gap="lg" padding="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap="lg">
            {stat(inv.skills.length, '个人 skill')}
            {stat(inv.plugins.length, `插件 · ${enabledCount} 已加载`)}
          </Box>
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text size="caption" dimColor tabular>
              {clock(inv.scannedAt)}
            </Text>
            <Button key="refresh" variant="secondary" onPress={refresh}>
              刷新
            </Button>
          </Box>
        </Box>

        {inv.error ? <Text color="error">扫描出错：{inv.error}</Text> : ''}

        <Box flexDirection="column" gap="sm">
          {sectionHead('个人 Skill', inv.skills.length, '~/.claude/skills · 点名字看说明')}
          {inv.skills.length === 0 ? <Text dimColor>还没有个人 skill</Text> : ''}
          {inv.skills.map(skillRow)}
        </Box>

        <Box flexDirection="column" gap="sm">
          {sectionHead('插件', inv.plugins.length, '本会话实际加载 + 本地已安装')}
          {inv.plugins.map(pluginRow)}
        </Box>
      </Box>
    )
  })
}
