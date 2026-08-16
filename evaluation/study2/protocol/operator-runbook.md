# ContextBranch Study 2 研究人员 Runbook

本手册对应当前 `study2-v2`：TreeNode Structure and Navigation 与 Exception
Group Matcher。每位参与者完成两个任务，一个使用 Linear，另一个使用
ContextBranch。任务顺序和条件由系统按参与者编号分配，研究人员不能现场选择。

## 1. 固定设置

同一轮正式实验必须使用同一组设置：

| 项目 | 固定值 |
| --- | --- |
| Provider | OpenRouter |
| Model | `google/gemini-2.5-flash-lite` |
| 每个任务时间 | 1300 秒，即 21 分 40 秒 |
| 模型调用 | 不限制次数或 tokens；完整记录 |
| 可见测试 | 本地 public tests |
| 最终提交 | `main` 的最终状态 |
| 私有检查 | 会后 clean private grader；参与者不可见 |

Linear 与 ContextBranch 的完整票据、初始代码、public tests、模型、时间、编辑权限
和最终评分规则必须相同。唯一实验差异是状态组织：Linear 只有一个 `main`；
ContextBranch 有 `main` 和两个从同一 checkpoint 创建的可选 sibling states。

## 2. 参与者编号与分配

`P000` 只用于技术 rehearsal。正式参与者从 `P001` 开始。退出或作废的编号不能
重新分配。

`study2-v2` 使用四个循环序列：

| 序列 | Period 1 | Period 2 |
| --- | --- | --- |
| V1 | TreeNode, Linear | Exception Group, ContextBranch |
| V2 | TreeNode, ContextBranch | Exception Group, Linear |
| V3 | Exception Group, Linear | TreeNode, ContextBranch |
| V4 | Exception Group, ContextBranch | TreeNode, Linear |

正式开始前先查看分配，不要手工改条件：

```bash
cd /Users/zli38/Documents/contextbranch-study
npm run study:assign -- P001 --task-set study2-v2
```

权威分配文件是 `evaluation/study2/operator/task-sets/study2-v2.json`。

## 3. 一次性环境准备

在正式收集使用的 checkout 中运行：

```bash
cd /Users/zli38/Documents/contextbranch-study

git status --short
git rev-parse HEAD
npm ci
npm run study:validate -- --task-set study2-v2
npm run study:build-tasks -- --task-set study2-v2
npm run study:setup-runtime
npm run study:preflight -- --task-set study2-v2
npm run study:dry-run -- --task-set study2-v2

npm run compile
npm run test:output-guard
npm run test:edit-recovery
npm run test:conflict-resolution
npm run test:study-ui
npm run build
npm run package
```

全部命令必须成功。记录 commit、VSIX 的 SHA-256、任务 manifest SHA-256、模型、
时间限制和运行日期。

安装刚生成的扩展：

```bash
code --install-extension \
  /Users/zli38/Documents/contextbranch-study/contextbranch-0.3.0.vsix \
  --force
```

若终端没有 `code` 命令，在 VS Code 打开 Extensions，选择 `...` →
`Install from VSIX...`，然后选择同一个 `contextbranch-0.3.0.vsix`。

在 VS Code Command Palette 中运行 `ContextBranch: Set API Key`，选择
`openrouter`，填入研究团队 API key。参与者不能看到、输入或复制 API key。

安装后执行 `Developer: Reload Window`。确认左侧是 Activity Bar 与 Explorer，
右侧是 ContextBranch，VS Code 内置 Chat 没有打开。
若 ContextBranch 面板没有出现，在 Command Palette 运行
`ContextBranch: Open Panel`。

## 4. 正式数据目录

正式实验应使用一个受控且可备份的 runs 目录。不要把正式数据放在 `/tmp`。
下面只用路径作为示例：

```bash
STUDY2_RUNS_ROOT=/secure/path/contextbranch-study2-runs
mkdir -p "$STUDY2_RUNS_ROOT"
```

第一次 `prepare` 会在该目录写入 `study-profile.json`，固定 provider、model 和
time limit。后续运行若给出不同设置会失败。

## 5. 每位参与者到场前

完成以下检查：

- 参与者 ID 与预约记录一致，只使用假名编号。
- 已查看 `study:assign` 输出。
- VS Code 没有打开其他参与者的 workspace。
- ContextBranch API key 已设置。
- 网络和 OpenRouter 可用。
- 屏幕缩放能同时看到 Explorer、编辑器、右侧 ContextBranch 和底部 Test Results。
- 信息说明、同意书、背景问卷、两份 Raw NASA-TLX 和访谈表已准备。
- onboarding 使用独立 toy workspace，不含 TreeNode 或 Exception Group 代码。

## 6. 准备 Period 1

第一次准备该 runs root 时必须明确给出固定 profile：

```bash
cd /Users/zli38/Documents/contextbranch-study

npm run study:prepare -- P001 1 \
  --task-set study2-v2 \
  --provider openrouter \
  --model google/gemini-2.5-flash-lite \
  --time-limit 1300 \
  --runs "$STUDY2_RUNS_ROOT"
```

若 profile 已存在，可以继续给出相同参数，也可以只给 task set 和 runs 目录。
保存命令输出中的 `runId`、`sessionRoot`、`workspace`、`taskId`、`formId` 和
`condition`。只打开输出中的准确 `workspace`：

```bash
code --new-window /exact/workspace/path/from/prepare
```

不要打开 `participant-bundles`、private bundle 或 reference implementation。

根据 `taskId` 和 `condition`，给参与者对应的一份说明：

| Condition | Task | 说明文件 |
| --- | --- | --- |
| Linear | TreeNode | `participant-instructions/linear-tree-node.md` |
| ContextBranch | TreeNode | `participant-instructions/contextbranch-tree-node.md` |
| Linear | Exception Group | `participant-instructions/linear-exception-group.md` |
| ContextBranch | Exception Group | `participant-instructions/contextbranch-exception-group.md` |

不要同时展示其他版本。

## 7. 标准 session 流程

建议总时长约 70 至 75 分钟：

| 环节 | 时间 |
| --- | --- |
| 同意、背景问卷、控制教学 | 10 分钟 |
| Period 1 | 最多 21 分 40 秒 |
| Raw NASA-TLX 1 | 约 3 分钟 |
| 切换 workspace | 约 2 分钟 |
| Period 2 | 最多 21 分 40 秒 |
| Raw NASA-TLX 2 | 约 3 分钟 |
| 简短访谈 | 约 10 分钟 |

### 7.1 Onboarding

在 toy workspace 中只教以下动作：

1. 找到当前 state 名称和聊天输入框。
2. 发送一条自己写的 prompt。
3. 阅读 AI 回复，查看 proposed edits。
4. 使用 `Apply selected` 或 `Discard`。
5. 点击测试按钮，在底部 Test Results 查看输出。
6. 在示例 ContextBranch workspace 中切换 state、打开 State Map、预览一次
   integration，但不讲任何正式任务的实现方法。

不要提供可直接复制到正式任务的 prompt。参与者应按自己的理解决定如何提问、
是否拆分工作、何时测试和是否 integration。

### 7.2 开始任务

让参与者先阅读 `.study/TASK.md`、允许编辑的文件和 public tests。此时计时还没
开始。参与者准备好后自己点击 `Start task`。点击后开始 1300 秒倒计时。

研究人员不能：

- 解释任务算法、边界情况或正确答案；
- 推荐先做 A 还是 B；
- 建议使用或忽略 sibling state；
- 编写 prompt、选择 AI edit 或解释 test failure；
- 展示 private tests 或 private grader 输出。

研究人员可以解释按钮含义，或处理明确的基础设施故障。

### 7.3 任务进行中

参与者可以多次调用模型，手工编辑允许的文件，并多次运行 public tests。没有调用
次数限制，唯一硬限制是任务时间。

测试按钮始终测试当前 state：

- Linear 或 ContextBranch `main`：`Test Main`，运行 A、B 和 integration。
- Responsibility A sibling：`Test A`。
- Responsibility B sibling：`Test B`。

完整 pytest 输出显示在 VS Code 底部 Test Results，不占用右侧聊天空间。

ContextBranch 中，一个 sibling 正在生成时，参与者可以切到另一个 sibling 并发送
prompt。两个 state 可以同时生成。不能在同一个 state 中同时发送两条 prompt。
不要关闭或 reload VS Code 来切换 state。

AI 回复若包含 proposed edits，参与者必须自己选择 `Apply selected` 或 `Discard`。
未 Apply 的回复不会改变代码。若出现 `Retry against current file`，参与者可自行决定
是否使用。

当前扩展对异常长输出有两项保护：

- 被中断的回答不会作为完整内容再次发送给模型，也不会自动应用代码。
- 同一个长 SEARCH/REPLACE block 重复三次时，生成会停止，也不会应用代码。

出现 output-limit、repetition 或 SEARCH-anchor 提示时，研究人员只说明“这次修改没有
自动应用；你可以自行决定下一步”。不要替参与者写更窄的 follow-up。

### 7.4 ContextBranch integration

参与者是否使用 sibling states 完全自愿。若要把当前 sibling 的工作带回 `main`：

1. 先处理该 state 的 pending edits。
2. 点击 `Integrate this state into main`。
3. 点击 `Preview integration`。
4. 阅读 artifact changes、rebase notes 和 conflict resolution。
5. 无冲突时点击 `Finalize merge`。
6. 有冲突时，可以审查 AI resolution、要求 AI revise，或选择
   `Resolve conflicts in IDE` 后再 finalize。
7. 回到 `main`，运行 `Test Main`。

Study integration preview 不替代 `Test Main`。Sibling 内测试通过也不代表最终任务
通过。只有 final `main` 被提交。

### 7.5 结束任务

参与者在认为完成时点击 `Finish task`。若模型仍在生成或测试仍在运行，按钮会暂时
不可用。倒计时到零时，系统自动固定当时的 final `main` 并导出 ZIP。未完成任务仍是
有效数据。

看到 `Task finished` 后停止编辑。不要为了提高结果重新打开、延长时间或修改
`.study/run.json`。

## 8. Period 1 后固定提交并准备 Period 2

参与者填写第一份 Raw NASA-TLX 时，研究人员检查 completion record 和 ZIP：

```bash
test -f /exact/period1/workspace/.study/finished.json
find /exact/sessionRoot/participant-exports -maxdepth 1 -name '*.zip' -print
```

立即按 Period 1 的实际 `runId` 收集固定提交。以下是 V1 的例子：

```bash
cd /Users/zli38/Documents/contextbranch-study

npm run study:collect -- \
  P001-period1-tree-node-navigation-linear \
  --runs "$STUDY2_RUNS_ROOT"
```

`study:collect` 会检查 Finish 时记录的生产文件哈希。检查失败时保留现场并记录
incident，不要修改 finished workspace。

保持同一个 runs root：

```bash
cd /Users/zli38/Documents/contextbranch-study

npm run study:prepare -- P001 2 \
  --task-set study2-v2 \
  --runs "$STUDY2_RUNS_ROOT"
```

打开新输出的准确 workspace，确认 task 与 condition 是分配中的 Period 2。重复同样
流程，不要把 Period 1 的代码、prompt 或 test output带入 Period 2。

## 9. Period 2 后固定提交

参与者填写第二份 Raw NASA-TLX 时检查：

```bash
test -f /exact/period2/workspace/.study/finished.json
find /exact/sessionRoot/participant-exports -maxdepth 1 -name '*.zip' -print
```

然后按 Period 2 的实际 `runId` 运行 `study:collect`。以下仍以 V1 为例：

```bash
cd /Users/zli38/Documents/contextbranch-study

npm run study:collect -- \
  P001-period2-exception-group-matcher-contextbranch \
  --runs "$STUDY2_RUNS_ROOT"
```

V1 应产生两个 ZIP：

```text
P001_tree-node-navigation_linear_1.zip
P001_exception-group-matcher_contextbranch_2.zip
```

实际文件名由分配决定。ZIP 包含 final main、任务元数据和状态/对话/telemetry；不含
API key、private tests 或 private grader。

## 10. Clean private grading

对已 collect 的 `submission/main` 运行对应 bundle 的 clean grader：

```bash
mkdir -p evaluation/study2/private-results

npm run study:grade -- \
  --bundle participant-bundles/tree-node-navigation \
  --submission \
    "$STUDY2_RUNS_ROOT/P001_YYYYMMDDTHHMMSSZ/P001-period1-tree-node-navigation-linear/submission/main" \
  --result \
    evaluation/study2/private-results/P001-period1-tree-node-navigation-linear.json
```

Exception Group 使用：

```text
--bundle participant-bundles/exception-group-matcher
```

grader 只把两个允许的生产文件复制到全新的 incomplete private baseline，再运行 A、B
和 integration 三组 clean checks。保存完整 JSON。不要把 private failure 反馈给参与者
或继续让模型修复。

每个 period 需要单独保留以下记录：

- `participantId`、`period`、`runId`、`formId`、task 和 condition；
- final `main` 的允许文件及 Finish 时的哈希；
- 实际耗时、是否 timeout、模型调用次数和 tokens，包括中断调用；
- public test 的运行时间、suite、退出状态和完整输出；
- state 切换、State Map 查看、integration preview/finalize 和 conflict 处理事件；
- completion record、自动 ZIP、collect 结果和 clean private grading JSON；
- 对应的 Raw NASA-TLX、访谈记录和 infrastructure incident。

正式分析按 `formId` 读取该 period 自动选择的等价测试 form。不要在 session 中根据
参与者表现改 form，也不要把不同 form 当成不同任务条件。

## 11. 中断和异常处理

| 情况 | 研究人员动作 |
| --- | --- |
| 模型输出达到上限 | 不应用 partial edit；参与者自行决定是否 follow-up；时间继续 |
| 检测到重复输出 | 工具自动停止且不应用；参与者自行决定下一步 |
| SEARCH anchor 找不到 | 使用工具提供的 retry 或让参与者自行处理；研究人员不写修复 prompt |
| OpenRouter 临时错误 | 记录时间和提示；参与者可重试；不重置计时 |
| 误关 VS Code | 重新打开同一 workspace；墙钟计时不重置 |
| 计时已结束 | 接受自动 final main；不能续时 |
| ZIP 未生成 | 保存 workspace 和日志，记录 infrastructure incident；不要手工伪造完成记录 |
| API key 暴露 | 立即停止 session、撤销 key，并按数据事故流程记录 |
| 参与者撤回同意 | 停止并按同意书删除数据；编号不复用 |

正式 session 中禁止像 rehearsal 一样手工改 `startedAt`、删除 `finished.json` 或复制
workspace 续跑。发生影响结果的工具故障时，保留原始证据并标记 infrastructure
incident。

## 12. 访谈问题

只问具体行为，不告诉参与者研究假设：

1. 你在什么时候运行了测试？测试结果怎样影响下一步？
2. 你如何决定每次给 AI 什么信息？
3. 在 ContextBranch 中，你是否切换了 states？为什么？
4. 你是否把 sibling state integration 回 main？为什么？
5. 哪个具体步骤最顺利？哪个步骤最费力？
6. 分开的对话、代码和测试记录有没有影响你理解任务的方式？

## 13. Session 完成标准

一位参与者的 session 只有在以下材料齐全时才算收集完成：

- 两个 `.study/finished.json`；
- 两个自动导出的 ZIP；
- 两个 `study:collect` 结果；
- 两个 clean private grading JSON；
- 两份 Raw NASA-TLX；
- 背景问卷与同意记录；
- operator incident log；
- 简短访谈记录。

Public 通过、branch 通过或 ZIP 存在都不能单独证明 feature delivery。最终分析使用
固定 final main 的 clean private 结果。

## 14. 当前版本的 rehearsal 证据与正式启动门槛

2026-08-16 的本地 rehearsal 得到以下可复查结果：

| 运行 | Public | Clean private |
| --- | ---: | ---: |
| TreeNode, ContextBranch | 9/9 | 15/20 |
| TreeNode, Linear，安装 output guard 后完成 | 9/9 | 15/20 |
| Exception Group, ContextBranch | 9/9 | 12/17 |

这些结果说明任务、integration、导出和 clean grading 路径可以运行，但不能说明
ContextBranch 已经优于 Linear。TreeNode 的两种条件 private 总通过数相同，只是三层
错误分布不同。

Linear rehearsal 还验证了：中断回答不再以完整内容进入下一轮上下文，之后三次调用
都正常结束。重复 block detector 已通过单元测试，但该次 live continuation 没有再次
触发重复，因此不能把它写成已完成的 live fault-injection 验证。该 rehearsal 中早期
两次失控输出发生在修复前，而且运行经历人工续跑，不能用于正式的时间、调用次数或
token 对比。

正式招募开始前，必须用当前 commit 和全新 `study:prepare` workspace 完成四种组合的
无重置技术 rehearsal：

- TreeNode, Linear；
- TreeNode, ContextBranch；
- Exception Group, Linear；
- Exception Group, ContextBranch。

每次都要确认：计时不重置、输出保护行为一致、ContextBranch 并发生成可用、public
test button 指向当前 state、integration 后 final main 正确、ZIP 自动生成、collect
哈希通过、clean grader 可执行。技术 rehearsal 的模型输出和 private 结果只能用于
检查流程，不能进入正式参与者结果表。
