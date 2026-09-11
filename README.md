# Paseo Workspace Cleaner

一个可信任的本地 Paseo 插件（Paseo **0.8.x**），用于：

- 从 Paseo History 硬删除单个 Agent；
- 在线归档 Workspace 并清理 Agent，或从独立卡片统一停机删除所有已归档 Workspace；
- 统一停机清理包含其下全部 Agent 和对应 Pi session；单独删除 Agent 时仍可选择是否移除 Pi session；
- 同一 Pi session 仍被其他 Agent 引用时自动保留；
- Pi session 优先进入系统废纸篓，废纸篓命令不可用时改名隔离，不直接永久删除；
- 在 **Settings → Plugins → Workspace Cleaner** 调整清理默认值，并查看停机删除为何不可用的只读诊断。

## 当前限制

Paseo 0.8 仍没有公开的 Workspace 永久删除协议，插件也不能改写 History 页面本身。本插件通过自己的侧边栏页面、Command Center、workspace header 按钮与 `/clean` 命令完成清理。在线“清理全部”保留归档记录；顶部“统一停机清理”集中移除所有已归档 Workspace，不再提供逐条停机入口。

活跃的 Paseo worktree 必须先使用 Paseo 原生 **Archive**，以保留未提交改动和未推送提交检查。随后可在 **Workspace Cleaner** 中删除历史及 Pi session。

## 界面

清理页采用 Paseo 主题色和可折叠 Project 列表，按 `projectId` 分组，展开后显示 Workspace 名称、完整 ID、目录及 Agent 状态。即使没有 Agent，归档 Workspace 仍可见。普通 Agent 列表通过 SDK 分页读取；注册表补充已归档 Workspace 和 Project。仅存在于存储的 Agent 必须通过官方 `inspect` 核实为已归档、已关闭、无待确认权限，才会纳入清理范围，不把存储快照假定为实时状态。

统一清理卡片显示归档 Workspace 与 Agent 数量，点击“预览停机清理”后由后台读取完整归档清单，显示 Project、Workspace 名称、完整 ID、目录和 Agent 数量，以及关联 Pi session 数量。点击“确认删除”即可，无需输入确认文字。统一清理固定包含 Pi session，仍会保护被其他 Agent 引用的共享 session；单个 Agent 的可选清理不变。

执行期间按钮禁用，窄窗口使用 Paseo 自带的底部确认面板。任务阶段、实际删除数量、警告及备份位置统一放在卡片内。Project 折叠标题没有缩放或弹跳效果，只保留背景和键盘焦点反馈。

所有清理入口都是浮层，不再产生清理标签页：header 垃圾桶按钮在宽屏弹锚定卡片、窄屏弹底部 sheet；Command Center 两项与 /clean 通过意图深链打开主页并自动弹出确认弹窗；主页行内按钮直接弹居中 dialog。浮层与弹窗按「身份、清理范围、动作」三层排布：名称是最强字阶，目录次之，机器 ID 最小且可选复制；「将永久删除」卡片先列出将被删除的每个 Agent（状态与 ID 前缀），读取中显示待定文案，读取失败显示错误而不伪装成空范围；破坏性按钮带危险描边与垃圾桶图标，确认弹窗仍是第二道闸。header 浮层另提供「仅已关闭（N）」：只删除已归档或已关闭的 Agent，不归档 Workspace，也不碰 idle 与 running；没有符合条件的 Agent 时按钮禁用。动作行（取消、仅已关闭、清理全部）固定在范围卡上方一行；范围卡随内容自然撑开，过长时由宿主浮层整体滚动，插件不设高度上限。

## 0.8 新增入口

- **Workspace header 按钮**：每个未归档 Workspace 的头部有一个垃圾桶图标按钮，直接弹出该 Workspace 的清理浮层，不开新标签页。按钮跟随 Workspace 列表增删；列表暂时读不到时保留现有按钮，不做破坏性撤销。
- **`/clean` 命令**：在 composer 输入 `/clean` 弹出当前 Workspace 的清理确认，不会发消息给 Agent。
- **Settings → Plugins → Workspace Cleaner → 清理设置**：
  - “默认同时移除 Pi session”与“默认展开 Project 列表”两个界面默认值，按 host 持久化，多端共享；
  - “停机删除可用性”只读诊断：解析到的 Paseo CLI 及其来源、daemon 版本与支持版本线、闸门未通过的全部原因、上次停机任务结果与备份目录。

设置页只承载界面默认值。Paseo CLI 路径仍由 daemon 环境变量决定，停机闸门仍由 server 侧校验，客户端无法通过设置改写要执行的可执行文件或绕过版本检查。

## 永久删除 Workspace 的维护方案

已实现为独立维护进程，正常停止插件或 daemon 后继续执行。当前仅允许 macOS 本机 Desktop 管理、监听为 `127.0.0.1:<端口>` 的 Paseo **0.8.x**；其他版本或管理方式拒绝执行，避免按未经验证的方式恢复服务。支持的次版本线只有一个来源：`shared/maintenance.ts` 的 `SUPPORTED_PASEO_MINOR`，版本闸门、维护进程连接声明与设置页诊断都从它读取。补丁版本（0.8.1、0.8.2…）无需改代码即放行；升到 0.9 时需要重新验证后修改该常量。被拒绝时，具体原因可在设置页的“停机删除可用性”中查看。

删除范围以 Workspace 是否归档为准，其下的 Agent 无论是否单独归档都纳入清理，确认窗口明确显示未单独归档的 Agent 数量。未归档 Workspace 及其 Agent 不删除，即使目录相同也不会合并删除。执行条件：整个 daemon 没有运行中、初始化中、活动轮次或待授权 Agent；没有启用的定时任务 / heartbeat 或尚未结束的定时运行。后台独立解析全部归档 ID，前端仅提交预览指纹；归档清单或关联 Agent 变化就拒绝旧确认，不静默扩大范围。清理任务互斥。

1. 将 Workspace 注册表和目标 Agent 元数据备份到 `<PASEO_HOME>/workspace-cleaner/<任务 ID>/`，权限仅限当前用户。**不备份时间线，官方 Agent 删除不可由这些备份完整撤销。**
2. 在线逐个调用绑定本机 daemon 的 `paseo agent delete <完整 ID> --json`，核验 ID、数量、列表及实际存储。任何失败都停止后续清理。
3. 再检查全部 Agent 与定时任务，然后 `paseo daemon stop --home ...`，不使用 `--force`。确认原 PID 退出、无替代 daemon、端口关闭后重读并备份注册表，只移除仍保持原状且无剩余 Agent 引用的目标行。其他字段与行保留，用原子替换写回。
4. 在停机状态下重新检查剩余 Agent 对 Pi session 的引用，然后同步清理目标 session。保留项目目录、Git worktree、其他 provider 的原生 session。
5. 在 `finally` 中尝试按原 home、监听地址和 Desktop 管理方式启动，并核对 server ID、连接及注册表。启动失败保留任务锁，状态为“需要人工恢复”，不显示成功。

Paseo 没有对其他客户端公开的维护锁，因此不能保证“空闲检查到停止”之间完全无竞态。确认后请勿从其他客户端发消息、启动 Agent 或启用定时任务，也不要手动启动另一个 daemon。发现变化会拒绝注册表写入。宿主系统关机或维护进程被强制终止时，无法保证自动恢复。

恢复异常时先查看任务目录内 `result.json` 和 `request.json`，确认实际删除项与 daemon 状态。先恢复 daemon，再人工核实无维护进程运行后处理 `maintenance.lock`；不要仅删除锁然后重试。`workspaces.stopped.json` 是注册表恢复参考，恢复也必须在 daemon 停止后进行，避免覆盖新记录。不会自动重试删除或自动覆盖备份。

## 安装

```bash
npm install
npm run test
npm run typecheck
npm run build
paseo plugin install /Users/liyijun/codex_default/paseo-workspace-cleaner
paseo plugin ls
```

安装后可从侧边栏打开 **Workspace Cleaner**，在 Workspace/Agent 中按 `⌘K`（Windows/Linux 为 `Ctrl+K`）搜索清理命令，点 Workspace 头部的垃圾桶按钮，或在 composer 输入 `/clean`。`paseo plugin ls` 必须为 `running`；异常时看 `paseo plugin logs paseo-workspace-cleaner`。

### 0.8 目录结构

0.8 的编译边界由目录决定，不再靠 `*.client.ts` / `*.server.ts` 后缀：

```text
index.client.tsx          # App 侧入口：侧边栏、Command Center、设置页、header 按钮、/clean
index.server.ts           # daemon 子进程入口：注册 settings 与全部 RPC handler
client/                   # 只编译进 App bundle：main / settings / header-buttons / defaults
server/                   # 只编译进 daemon bundle：cleanup / maintenance / diagnostics / 维护进程
shared/                   # 两侧共用：Zod 契约、settings 定义、纯值与纯函数
dist/maintenance.mjs      # esbuild 产出的独立维护进程
```

`paseo-plugin.json` 声明 `requirements.paseo: "^0.8.0"`，即只允许 0.8.x（含预发布）。Paseo 0.9 会直接拒绝加载，而不是带着不确定的行为运行；那时需要重新跑一次迁移并抬高这个范围。

插件后端会调用同一台 daemon 上的 `paseo agent delete`。如果 `paseo` 不在 daemon 的 `PATH`，可通过 daemon 环境变量 `PASEO_CLI_PATH` 指定绝对路径；实际生效的值与来源可在设置页诊断中确认。

源代码改动后先测试、类型检查、构建，再 `paseo plugin reload paseo-workspace-cleaner`，无需重启 daemon。独立进程构建产物为 `dist/maintenance.mjs`。

安全诊断：`node dist/maintenance.mjs --check` 只读检查当前归档范围及阻止条件；`--probe` 只验证进程能启动，不接触 daemon。设置页的“停机删除可用性”也是只读的，只跑 `paseo daemon status` 并读上次任务结果。单元测试使用临时目录和注入的生命周期，不在真实用户数据上执行停机或删除。
