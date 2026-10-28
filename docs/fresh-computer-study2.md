# 新电脑运行 GitChat 用户测试

本指南用于研究人员配置一台新电脑，运行 `study2-v2` 的两个任务。代码以合并 PR #14 后的 `3187de61bee64f078900332e6b9c50d47257aa59` 为验证依据。每任务使用 1200 秒，即 20 分钟。

## 1. 安装基础软件

安装 [Git](https://git-scm.com/downloads/)、[Node.js 24 LTS](https://nodejs.org/en/download)、[Python 3.14](https://www.python.org/downloads/)、[VS Code](https://code.visualstudio.com/download)。Node 安装包包含 npm。Python 使用 3.14 系列，避免新电脑自动选中其他版本。

在终端确认：

```text
git --version
node --version
npm --version
code --version
```

Mac 另外检查 `python3 --version`；Windows 检查 `py -3.14 --version`。Mac 把 VS Code 放进 Applications，在命令面板运行 `Shell Command: Install 'code' command in PATH`，然后重新打开终端。Windows 安装 Git、Node、Python 和 VS Code 后重新打开终端；PowerShell 若阻止执行 npm.ps1，用 `npm.cmd` 替代下文命令中的 `npm`。

## 2. 从 GitHub 获取代码并构建

在用于存放研究软件的目录执行：

```bash
git clone https://github.com/li-ziyou/contextbranch-study.git
cd contextbranch-study
git rev-parse HEAD
npm ci
npm run compile
npm run build
npm run package
```

构建产物是仓库根目录的 `contextbranch-0.3.0.vsix`。在 VS Code 的 Extensions 页面打开右上角菜单，选择 `Install from VSIX...` 安装它，再运行 `Developer: Reload Window`。

终端已能使用 code 时，也可以安装：

```bash
code --install-extension ./contextbranch-0.3.0.vsix --force
```

## 3. 在新电脑生成任务和 Python 环境

先指定安装好的 Python 3.14。

Mac 的终端：

```bash
export PYTHON="$(python3.14 -c 'import sys; print(sys.executable)')"
```

Windows PowerShell：

```powershell
$env:PYTHON = (& py -3.14 -c "import sys; print(sys.executable)")
```

然后在仓库根目录依次执行：

```bash
npm run study:validate -- --task-set study2-v2
npm run study:build-tasks -- --task-set study2-v2
npm run study:setup-runtime
npm run study:preflight -- --task-set study2-v2
npm run study:dry-run -- --task-set study2-v2
```

Windows PowerShell 可以将这里的 `npm` 全部写为 `npm.cmd`。这些命令会创建 `.study-builder`、`.study-runtime` 和两个 participant bundles，无需手动激活虚拟环境。

成功标志是输出中同时出现：

```text
Dry run passed: exception-group-matcher
Dry run passed: tree-node-navigation
```

自检使用临时参考实现验证评分流程，不会把参考代码写入待发放的初始任务包。任务包由本机源码重新生成；不要从旧电脑复制做过题的 participant-bundles 或 workspace。

## 4. 固定模型和 20 分钟计时

当前启动器默认使用 OpenRouter 的 `google/gemini-2.5-flash-lite`。以下显式记录同一模型和 1200 秒时间，供本轮全部参与者使用。若本轮使用其他固定模型，在首次创建数据目录前填写该模型 ID。

Mac 的终端：

```bash
export CONTEXTBRANCH_STUDY_PROVIDER=openrouter
export CONTEXTBRANCH_STUDY_MODEL=google/gemini-2.5-flash-lite
export CONTEXTBRANCH_STUDY_TIME_LIMIT=1200
```

Windows PowerShell：

```powershell
$env:CONTEXTBRANCH_STUDY_PROVIDER = "openrouter"
$env:CONTEXTBRANCH_STUDY_MODEL = "google/gemini-2.5-flash-lite"
$env:CONTEXTBRANCH_STUDY_TIME_LIMIT = "1200"
```

保持在这个终端继续运行。首次启动会把设置写入指定数据目录的 `study-profile.json`。已存在的 profile 优先，之后修改环境变量不会覆盖它。当前代码的 launch 默认时间为 1300 秒，prepare 默认时间为 1500 秒，因此需要上述显式设置，并在首轮启动输出中确认 `timeLimitSeconds` 为 1200。

## 5. 先运行一次 P000 练习

在仓库根目录执行：

```bash
npm run study:launch -- P000 G1 --task-set study2-v2 --runs ./evaluation/study2/runs/rehearsal
```

Windows PowerShell 可使用 `npm.cmd run ...`。命令创建两个独立 workspace，依次请求打开两个 VS Code 窗口，以及对应的两份问卷页面：

| 顺序 | 任务 | 工具 |
|---|---|---|
| Period 1 | TreeNode | Linear |
| Period 2 | Exception Group Matcher | ContextBranch |

以启动输出中的 workspace 路径为准。确认每个窗口显示对应任务说明和 20 分钟时间；打开窗口不会开始计时。

在第一个窗口用命令面板运行 `ContextBranch: Set API Key`，选择 `openrouter`，由研究人员输入团队密钥。随后运行 `ContextBranch: Open Panel`。密钥保存在 VS Code 的 SecretStorage 中；同一 VS Code 用户配置下，另一任务窗口也可使用。模型调用还需要该 key 对应账户有可用额度。

P000 用于检查实际界面和模型调用：点击 `Start task`，发送一条练习提示，确认有模型回复、修改可应用、`Test Main` 能执行。初始实现尚未完成时，公开测试失败是预期结果。练习结束后检查 `Finish task` 和自动导出的 ZIP。

## 6. 正式启动参与者

关闭练习窗口，保持相同的模型和计时环境变量，使用独立正式数据目录：

```bash
npm run study:launch -- P001 G1 --task-set study2-v2 --runs ./evaluation/study2/runs/formal
```

`P001` 替换为实际参与者编号，`G1` 替换为事先分配的 G1–G4。同一参与者两段任务由这一条命令一起准备，之后只需打开对应窗口。后续参与者继续使用相同 formal 数据目录。

| 组 | Period 1 | Period 2 |
|---|---|---|
| G1 | TreeNode · Linear | Exception Group · ContextBranch |
| G2 | TreeNode · ContextBranch | Exception Group · Linear |
| G3 | Exception Group · Linear | TreeNode · ContextBranch |
| G4 | Exception Group · ContextBranch | TreeNode · Linear |

参与者阅读各自 workspace 的 `.study/TASK.md`，准备好后点击 `Start task`。每段结束点击 `Finish task`，并填写对应问卷。只提交最终 main；需要使用的 sibling 修改应由参与者整合进 main。

## 7. 收集结果

参与者完成两个 period 后，在仓库根目录执行：

```bash
npm run study:collect -- P001 1 --runs ./evaluation/study2/runs/formal
npm run study:collect -- P001 2 --runs ./evaluation/study2/runs/formal
```

每次 Finish 后即可收集对应 period，不必等待两段全部结束。收集命令会校验结束时记录的文件哈希，因此 Finish 后保持代码不动。数据保存在 `formal/<参与者_时间戳>/`；自动 ZIP 位于其中的 `participant-exports/`。备份整个会话目录。

后续评分使用 collect 输出的实际 submission 路径。例如 TreeNode 的 Mac 命令：

```bash
.study-runtime/bin/python evaluation/study2/private-grader/grade_submission.py --bundle participant-bundles/tree-node-navigation --submission /实际路径/submission/main --result /实际路径/tree-grade.json
```

Windows 使用 `.\.study-runtime\Scripts\python.exe`，并替换为本机实际路径。异常组任务使用 `participant-bundles/exception-group-matcher`。

## 本次核验

2026-10-28，从远端 main 新克隆到独立空目录，在 macOS arm64、Node 24.18.0、Python 3.14.0 下完成 npm ci、编译、构建、VSIX 打包、任务生成、独立 Python 环境安装、preflight 和 reference dry-run。新环境安装 pytest 9.2.0。

- Exception Group：公开 9/9，评分 17/17。
- TreeNode：公开 9/9，评分 20/20。
- P000/G1：两个 workspace 均为冻结初始代码，timeLimitSeconds 为 1200，startedAt 为 null，初始公开测试各 9 项失败。
- 启动器的两个窗口请求与两个问卷 URL 已通过捕获调用核验；本次没有实际打开新窗口、安装扩展或调用付费模型。新电脑应完成第 5 节的实际界面和模型试运行。
- Windows 命令按当前启动器分支核对，本次没有在 Windows 系统执行。

源码操作入口为 `evaluation/study2/operator/studyctl.mjs`；扩展密钥入口为 `src/extension.ts`。官方安装说明见 [VS Code 命令行](https://code.visualstudio.com/docs/configure/command-line)、[VS Code Mac 安装](https://code.visualstudio.com/docs/setup/mac)、[Node 下载](https://nodejs.org/en/download) 和 [Python 下载](https://www.python.org/downloads/)。
