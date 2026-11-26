# Skills Sidebar for Claude Code

A sidebar pane that shows, at a glance, every skill and plugin your Claude Code session has loaded.

Claude Code's plugin page only lists packages installed through a marketplace. Skills you drop into `~/.claude/skills/` never show up there, and plugins enabled through your claude.ai account (Data, Design and the like) keep their on/off state on the server. This mod asks the session itself what it loaded, so the list matches what you can actually use right now.

在 Claude Code 侧边栏里列出本会话实际加载的全部 skill 和插件：个人 skill、本地插件、claude.ai 账号同步的插件和内置 skill。界面文字为中文。

## What it shows

- **Personal skills** in `~/.claude/skills/` (folders, symlinks and junctions), with skills you can only start by hand marked `手动`.
- **Plugins**, each tagged by where it came from (`本地` local, `账号` claude.ai account, `内置` built-in), what it carries (skills, commands, agents, hooks, MCP) and whether this session loaded it.
- Click any row to read its full description.

## Open it

- Click **我的能力** in the row above the prompt box, or
- run `/skills-sidebar`.

Neither writes anything into the conversation. Press **刷新** in the pane after adding a skill.

## Install

At the prompt of a terminal session:

```
/plugin install skills-sidebar --marketplace YUGOOD515/claude-skills-sidebar
```

Answer `y` to add the marketplace, then press Enter to pick the user scope.

From a shell:

```
claude plugin install skills-sidebar --marketplace YUGOOD515/claude-skills-sidebar
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `YUGOOD515/claude-skills-sidebar`, then **Add plugin**.

## Notes

- It only reads files under `~/.claude/`; it writes nothing.
- A plugin with no slash commands (an LSP server, hooks only) is listed from the local install record, so one enabled only through your account may not appear.

## License

MIT
