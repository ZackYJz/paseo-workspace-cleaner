# 会话管理

Paseo 插件，在侧栏里叫「会话」。一个页面看全部会话，顺手清理不要的。

- 按项目和 Workspace 列出所有 Agent，实时显示哪些在等你处理、哪些在运行。
- 勾选后批量删除 Agent 和时间线，对应的 Pi 会话文件移到废纸篓。
- 可选：Workspace 归档满宽限期后自动清理。

所有删除都走 Paseo 官方命令，不停 daemon，不改写 Paseo 的存储文件。插件 id 是 `paseo-workspace-cleaner`。原来的 workspace-agent-count（Agent 总览）已并入本插件。

## 会话页

从侧栏「会话」打开。

**顶部**：Agent、Workspace、可清理的数量，刷新按钮，以及筛选和搜索。

- 筛选：全部 / 需要处理 / 运行中 / 可清理，各带数量，默认「全部」。
- 搜索：匹配会话标题、Workspace 名和项目名。

**等你处理**：在「全部」视图、没有搜索时显示在最上面，列出等待授权、出错、需要处理的会话，等得最久的在前，点一下直接打开。

**列表**：按项目分组，项目可以折叠。

- Workspace 行：名称（点击打开）、状态（运行中、需要输入、失败等，取 Paseo 自己的汇总）、未提交改动（`+1.5M −38k`）、Agent 数、最近活动。
- Agent 行：状态点、标题、状态、provider、最近活动。实心点表示状态需要留意（红：等待授权、出错；强调色：运行中；绿：已完成），空心点表示空闲、已关闭或已归档。
- 点 Agent 行打开会话，点左侧勾选框才是选中。Workspace 行的勾选框一次选中它下面的全部 Agent。选中后底部出现「删除 N 个」。
- 活跃 Workspace 行右侧的归档图标是「归档并清理」：先归档，再删除其下全部 Agent。

页面会自动刷新：会话开始或结束、等待授权、归档、标题或改动变化时重新读取。Agent 输出内容时不触发刷新。

## 其他入口

都是浮层，不打开新页面。

- Workspace 顶栏的垃圾桶按钮。
- Command Center（⌘K）：「清理当前 Workspace」「删除当前 Agent」。
- 输入框里的 `/clean`。

垃圾桶浮层从上到下是：Workspace 名和目录，删除范围（全部 Agent / 仅已关闭或已归档），将受影响的 Agent，Pi 会话开关，最后是按钮。按钮直接写「删除 N 个 Agent」，数量跟着范围变；选「仅已关闭或已归档」时，会保留的行变淡并标「保留」。

## 删除时会发生什么

- Agent 记录和时间线永久删除，无法撤销。项目文件、Git worktree、其他 provider 的原生会话不动。
- Pi 会话文件：开关打开时移到系统废纸篓，废纸篓不可用时改名隔离，不直接删除。仍被其他 Agent 使用的会话文件会保留。范围里没有 Pi Agent 时不显示这个开关。
- 运行中的 Agent 会先被中断再删除，确认前会提示。
- 清理按顺序排队，一次只执行一个。连续删除几个 Workspace 时，后一个会等前一个完成。最多等 40 秒，等不到就放弃这次请求、什么都不删，并提示稍后重试。

## 自动清理

在 Settings → Plugins → 清理设置里打开，默认关闭。宽限期可选 1、3、7、14、30 天，默认 7 天。

- 条件：Workspace 已归档满宽限期，且其下 Agent 都已归档或已关闭、没有进行中的回合和待处理的授权，否则跳过。
- 宽限期内仍可在 Paseo 里恢复 Workspace。删除前会再确认一次，期间被恢复的不会动。
- 是否同时移除 Pi 会话文件，跟随设置里的默认值。
- 每小时最多运行一轮。插件刚加载时，要等到第一个事件（新建 Agent、回合结束、归档等）或打开会话页才开始计时；刚打开开关时会立即检查一轮。
- 手动清理进行中时，这一轮让路，下次再试。
- 设置页的「状态」显示当前已到期的范围和上次自动清理的结果，每一轮的记录也在 `paseo plugin logs paseo-workspace-cleaner` 里。

## 要求与已知限制

- Paseo 0.11.0 或更高，2026-10 在 0.11.2 上验证。
- 插件后端会在 daemon 所在机器上调用 `paseo agent delete` 和 `paseo agent inspect`。`paseo` 不在 daemon 的 `PATH` 里时，用环境变量 `PASEO_CLI_PATH` 指定绝对路径，设置页「状态」里能看到实际使用的路径。
- 截至 0.11.2，Paseo 的 Agent 列表会漏掉一部分已归档 Agent。插件会只读地补读 `~/.paseo/agents`，并逐个用 `paseo agent inspect` 确认它们确实已归档、已关闭，确认不了就不继续。
- 已归档且没有 Agent 的 Workspace 不会列出，因为 Paseo 自己也不再显示它们。Paseo 没有提供删除 Workspace 记录的接口，这些记录会留在 Paseo 的注册表里；以后在同一目录新建 Workspace 时，Paseo 会复用这条记录，旧标题也会回来。
- 旧版「停机清理」已移除。它留下的任务目录和备份在 `~/.paseo/workspace-cleaner/`，插件不再读写，确认不需要后可以手动删除。

## 开发

```bash
npm install
npm run test
npm run typecheck
paseo plugin install /absolute/path/to/paseo-workspace-cleaner
paseo plugin ls
```

`paseo plugin ls` 里应为 `running`，异常时看 `paseo plugin logs paseo-workspace-cleaner`。改完源码先测试和类型检查，再 `paseo plugin reload paseo-workspace-cleaner`，不需要重启 daemon。

```text
index.client.tsx          App 入口：会话页、侧栏项、Command Center、设置页、顶栏按钮、/clean
index.server.ts           daemon 入口：设置、RPC、自动清理的触发
client/main.tsx           会话页
client/live-refresh.ts    会话页的实时刷新（自己持有 agent / workspace 目录订阅）
client/cleanup-dialog.tsx 顶栏垃圾桶浮层与各个确认弹窗
client/header-buttons.ts  按 workspace 注册顶栏按钮
server/cleanup.ts         删除 Agent、移除 Pi 会话文件、清理排队
server/auto-cleanup.ts    到期判定与自动清理调度
server/registry.ts        Paseo 注册表与 Agent 存储的只读访问
shared/agent-state.ts     状态文案、颜色和排序
```

单元测试使用临时目录和模拟的 `paseo` 命令，不会在真实数据上执行删除。
