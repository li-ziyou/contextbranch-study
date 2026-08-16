# Study 2 participant instruction versions

研究人员必须根据 `study:prepare` 输出的 `condition` 和 `taskId`，只给参与者一份对应
说明。

| Condition | Task | File |
| --- | --- | --- |
| Linear | TreeNode | `linear-tree-node.md` |
| ContextBranch | TreeNode | `contextbranch-tree-node.md` |
| Linear | Exception Group | `linear-exception-group.md` |
| ContextBranch | Exception Group | `contextbranch-exception-group.md` |

四份说明使用简单英文，便于直接展示或朗读。TreeNode 的两个版本包含相同的完整任务
内容；Exception Group 的两个版本也包含相同的完整任务内容。工具说明只描述参与者
实际获得的状态组织，不说明研究假设，也不推荐实现顺序。

实际运行中的 `.study/TASK.md` 和只读 public tests 仍是权威任务材料。修改任何一份
participant instruction 后，必须运行 `npm run study:validate -- --task-set study2-v2`，
并再次检查同一任务的 Linear 与 ContextBranch 要求逐字一致。
