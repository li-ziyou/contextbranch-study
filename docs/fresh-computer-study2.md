# 安装一个 VSIX，运行两段用户测试

研究人员使用 `contextbranch-0.4.0.vsix`。支持 Windows、macOS 和 Linux 的 x64/ARM64 桌面 VS Code。首次配置会自动下载隔离的 Python 3.14.0 与 pytest 9.2.0；不要求事先安装 Git、Node 或 Python。首次准备环境和使用 OpenRouter 都需要联网。

## 1. 安装扩展

在桌面 VS Code 中打开扩展页面，点击右上角 `…` → `Install from VSIX…`，选择 `contextbranch-0.4.0.vsix`，然后重新加载窗口。打开 ContextBranch 面板。

## 2. 设置研究会话

点击 `Set up user study`，也可在命令面板运行 `ContextBranch: Set Up User Study`。依次填写：

- 参与者编号，例如 P001；P000 留给练习。
- 已分配的 G1、G2、G3 或 G4。
- 研究人员的 OpenRouter API key。已保存该 key 时会复用，修改 key 使用 `ContextBranch: Set API Key`。
- 研究数据存放文件夹。

扩展自动准备环境、核对内置任务文件，创建两个初始 workspace，然后打开第一个任务。同一次设置得到的两个任务共用一个会话目录；再次设置会创建新目录，不会覆盖此前任务。

默认固定 OpenRouter 模型 `google/gemini-2.5-flash-lite`，每个任务 1200 秒。模型 ID、分组、任务形式、版本和开始时间均写入会话记录；API key 仅保存在 VS Code SecretStorage 中。

| 组 | 第一个任务 | 第二个任务 |
|---|---|---|
| G1 | TreeNode · Linear | Exception Group · ContextBranch |
| G2 | TreeNode · ContextBranch | Exception Group · Linear |
| G3 | Exception Group · Linear | TreeNode · ContextBranch |
| G4 | Exception Group · ContextBranch | TreeNode · Linear |

## 3. 执行任务

阅读当前 workspace 的 `.study/TASK.md`，点击 `Start task` 才开始计时。点击 `Test A`、`Test B` 或 `Test Main` 查看当前状态的公开测试。需要的 sibling 修改由参与者整合进 main。点击 `Finish task` 完成当前任务；到时仍按现有逻辑自动结束。

`Open other task` 打开已经准备好的另一段任务。它可以重新打开原目录，保留其中的数据。研究人员还可使用命令面板的 `ContextBranch: Open Other Study Task`。

## 4. 随时导出研究包

点击 `Export research package`，或运行 `ContextBranch: Export Research Package`，选择一个新的 ZIP 文件名。两个任务各自的可用数据会放进同一个包。任务不需要先点 Finish，也不需要先通过测试。

包里包括：

- 参与者编号、G 组、两段任务的分配、模型与版本信息。
- 各段的开始时间、现有 Finish 记录、完成/超时/未开始/中断状态。
- 所有已保存分支的对话、代码工件、检查点、整合记录和操作日志。
- 公开测试及输出记录。
- 当前磁盘上的任务代码，以及各个已记录代码状态；两者分开命名。
- 恢复快照中的未应用修改、未完成的模型回复、允许编辑文件的未保存内容。
- 已存在的原始完成 ZIP。

导出不会生成假的 Finish 记录、不会切换状态、不会保存编辑器缓冲区，也不会覆盖已有 ZIP。原始完成 ZIP 与之后的研究快照分别保留。未开始或缺失数据的任务会在包内标明；结束后又变化的代码会在清单中注明。

当前窗口在导出时立即保存恢复快照；另一任务窗口定期保存自己的快照。重开窗口前的最后恢复状态会另存保留。屏幕/音频录像和问卷答卷由研究流程单独收集，扩展不会凭空生成这些材料。

## 包内结构

```text
metadata/session.json       会话分配和版本
metadata/export.json        导出时间、两段状态及文件校验值
periods/1/                  第一个任务
periods/2/                  第二个任务
  metadata/                 任务、开始/完成记录、恢复状态
  workspace/                导出时已保存的任务代码
  states/                   每个已记录状态的代码与对话
  contextbranch/            原始对话、工件、检查点和操作日志
  public-tests/             参与者可见测试
  recovery/                 重开窗口前保留的恢复记录
completion-archives/        已存在的原始完成 ZIP
```

## 从源码构建

```bash
npm ci
npm run compile
npm run test:study-standalone
npm run package
```

构建脚本每次从冻结的初始资产生成 `study-assets/`，不复用已经做过题的 participant-bundles。VSIX 使用文件白名单，只包含编译扩展、界面、公开初始任务和公开测试。参考代码、隐藏测试、源 checkout、运行数据、下载缓存和 API key 不进入安装包。
