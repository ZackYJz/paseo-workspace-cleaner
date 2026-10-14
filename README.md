# Session Manager (paseo-workspace-cleaner)

**English** | [简体中文](README.zh-CN.md)

A Paseo plugin, shown in the sidebar as 「会话」 (Sessions). One page to see all your sessions, and to clean up the ones you no longer need. The plugin UI is currently in Chinese.

- Lists every agent by project and workspace, and shows live which ones are waiting for you and which are running.
- Select agents to delete them and their timelines in bulk; the matching Pi session files are moved to the Trash.
- Optional: automatically clean up a workspace after it has been archived for a grace period.

Every deletion goes through Paseo's official commands. The daemon is not stopped and Paseo's storage files are never rewritten. The plugin id is `paseo-workspace-cleaner`. The former workspace-agent-count plugin (agent overview) has been merged into this one.

## Sessions page

Open it from the 「会话」 entry in the sidebar.

**Top bar**: counts of agents, workspaces and cleanable items, a refresh button, and filter and search.

- Filters: All / Needs attention / Running / Cleanable, each with a count. The default is All.
- Search: matches session titles, workspace names and project names.

**Waiting for you**: in the All view with no search active, this section sits at the top. It lists sessions that are waiting for permission, failed or need attention, longest-waiting first. One click opens a session.

**List**: grouped by project; projects can be collapsed.

- Workspace row: name (click to open), status (running, needs input, failed and so on, taken from Paseo's own summary), uncommitted changes (`+1.5M −38k`), agent count and last activity.
- Agent row: status dot, title, status, provider and last activity. A filled dot means the state needs a look (red: waiting for permission or failed; accent color: running; green: finished). A hollow dot means idle, closed or archived.
- Click an agent row to open the session; only the checkbox on the left selects it. The checkbox on a workspace row selects all agents under it. Once something is selected, a "Delete N" button appears at the bottom.
- The archive icon on the right of an active workspace row is "Archive and clean up": it archives the workspace first, then deletes all agents under it.

The page refreshes itself when a session starts or ends, waits for permission, is archived, or when a title or change count changes. It does not refresh while an agent is streaming output.

## Other entry points

All of them are popovers; none opens a new page.

- The trash button in the workspace header.
- Command Center (⌘K): "Clean up current workspace" and "Delete current agent".
- `/clean` in the prompt box.

The trash popover shows, top to bottom: the workspace name and directory, the deletion scope (all agents / only closed or archived), the affected agents, the Pi session switch, and the button. The button reads "Delete N agents" and the number follows the scope. With "only closed or archived", the rows that will be kept are dimmed and marked "Keep".

## What happens on delete

- Agent records and timelines are deleted permanently and cannot be undone. Project files, Git worktrees and native sessions of other providers are untouched.
- Pi session files: with the switch on, they are moved to the system Trash; if the Trash is unavailable they are renamed and set aside, never deleted outright. A session file still used by another agent is kept. If no Pi agent is in scope, the switch is not shown.
- Running agents are interrupted first and then deleted, with a warning before you confirm.
- Cleanups are queued and run one at a time. When you delete several workspaces in a row, each waits for the previous one. A request waits at most 40 seconds; if it cannot start by then, it is abandoned, nothing is deleted, and you are asked to retry later.

## Auto cleanup

Turn it on under Settings → Plugins → 清理设置 (Cleanup settings). It is off by default. The grace period can be 1, 3, 7, 14 or 30 days, 7 by default.

- Condition: the workspace has been archived for the full grace period, and all its agents are archived or closed with no turn in progress and no pending permission request. Otherwise it is skipped.
- During the grace period you can still restore the workspace in Paseo. It is checked once more before deletion, and a workspace restored in the meantime is left alone.
- Whether Pi session files are removed as well follows the default in settings.
- It runs at most once an hour. After the plugin loads, the timer only starts at the first event (a new agent, a finished turn, an archive and so on) or when the Sessions page is opened; switching the setting on triggers an immediate check.
- If a manual cleanup is in progress, that round yields and tries again later.
- The "Status" section of the settings page shows what is currently due and the result of the last auto cleanup. Each round is also recorded in `paseo plugin logs paseo-workspace-cleaner`.

## Requirements and known limitations

- Paseo 0.11.0 or later; verified on 0.11.2 in October 2026.
- The plugin backend calls `paseo agent delete` and `paseo agent inspect` on the machine running the daemon. If `paseo` is not on the daemon's `PATH`, set the environment variable `PASEO_CLI_PATH` to its absolute path. The path actually used is shown under "Status" on the settings page.
- As of 0.11.2, Paseo's agent list misses some archived agents. The plugin reads `~/.paseo/agents` (read-only) to fill the gap, and confirms each one with `paseo agent inspect` as archived and closed; if it cannot confirm, it does not go on.
- Archived workspaces with no agents are not listed, since Paseo itself no longer shows them. Paseo has no API for deleting workspace records, so these stay in Paseo's registry. When you later create a workspace in the same directory, Paseo reuses the record and the old title comes back.
- The old shutdown cleanup has been removed. The task directories and backups it left are in `~/.paseo/workspace-cleaner/`; the plugin no longer reads or writes them, and you can delete them by hand once you are sure you do not need them.

## Development

```bash
npm install
npm run test
npm run typecheck
paseo plugin install /absolute/path/to/paseo-workspace-cleaner
paseo plugin ls
```

`paseo plugin ls` should show `running`; if not, check `paseo plugin logs paseo-workspace-cleaner`. After editing the source, run the tests and the type check, then `paseo plugin reload paseo-workspace-cleaner`. No daemon restart is needed.

```text
index.client.tsx          App entry: Sessions page, sidebar item, Command Center, settings page, header button, /clean
index.server.ts           Daemon entry: settings, RPC, auto-cleanup trigger
client/main.tsx           Sessions page
client/live-refresh.ts    Live refresh of the page (holds its own agent / workspace directory subscriptions)
client/cleanup-dialog.tsx Header trash popover and the confirmation dialogs
client/header-buttons.ts  Registers the header button per workspace
server/cleanup.ts         Deletes agents, removes Pi session files, queues cleanups
server/auto-cleanup.ts    Due-date check and auto-cleanup scheduling
server/registry.ts        Read-only access to Paseo's registry and agent storage
shared/agent-state.ts     Status text, colors and sorting
```

Unit tests use temporary directories and a mocked `paseo` command; they never delete anything on real data.
