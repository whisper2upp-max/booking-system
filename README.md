# Booking System v3.6

离线排班与项目管理工具，支持 EIC 排班、项目总览、节点日历、预算、实际工时、Task 分工、人员主数据及数据备份恢复。

## 使用

1. 从 Releases 下载 `booking-system-v3.6.zip` 并完整解压。
2. 使用桌面版 Chrome 或 Edge 打开 `app/booking system v3.6.html`，所有依赖随包提供，无需联网。
3. 首次打开按同一窗口的两步提示，先设置 FIC / EIC 维护身份，再选择备份文件夹；取消后下次继续未完成步骤。FIC 提交完整快照，EIC 通过“导入 FIC 数据”定向更新并按人员汇总。共享项目资料在预览中确认采用来源。
4. 点击顶部“管理人员主数据”，下载模板，填写 Name、Email、Level、FIC、EIC 后导入。Level 使用下拉选项；姓名支持点号或空格。
4. 导入排班、预算等业务数据。顶部“使用说明”提供完整操作指引。
5. 选择自动备份文件夹。网页运行期间每两小时备份一次，最多保留五份；也可手动导出 JSON 或从备份恢复。

## 数据与隐私

仓库和 Release 不含人员名单、邮箱映射、实际项目数据或业务备份。人员主数据初始为空，所有用户数据由用户自行导入并保存在当前浏览器中。已有浏览器保存的主数据仍会保留。

私有仓库不是业务数据的备份位置。不要提交填写后的 Excel、人员信息、浏览器导出 JSON 或业务截图。空白模板仅包含表头；姓名和邮箱示例使用虚构名称与 `example.com`。

浏览器清除站点数据、更换浏览器或打开位置可能影响已有数据与目录授权。迁移前请导出完整 JSON 备份。自动备份要求浏览器支持目录读写，并保持网页运行。

## 文档

- [使用说明](使用说明_v3.6.md)
- [更新日志](更新日志_v3.6.md)

## 开发与构建

`src/workspace.jsx` 和 `src/project-overview.jsx` 为主要界面源码；`app` 包含离线运行文件。修改源码后执行：

```sh
python3 scripts/sync_workspace.py
node scripts/render_guide.cjs
python3 scripts/package_user_release.py
```

构建前会检查内置人员名单必须为空，输出目录为仓库同级的 `使用者分发/v3.6`，压缩包为 `booking-system-v3.6.zip`。

检查：

```sh
node tests/test_workspace_store.cjs
node tests/test_auto_backup.cjs
node tests/test_teams.cjs
node tests/test_teams_ui.cjs
```

浏览器测试需在开发环境提供 Playwright；普通使用者无需安装。测试仅使用虚构人员，不使用真实名单。

## 跨版本设置兼容

维护身份和固定来源编号存于 `booking-workspace-v3` 的 `matches.teamWorkspaceV1`；目录句柄存于 IndexedDB `booking-auto-backup`。这些标识不能拼接版本号，也不能在升级时重置。后续升级必须保留既有字段或执行迁移。

同一浏览器用户和可访问的本地存储中，新版本直接读取既有身份与目录。浏览器若要求目录重新授权，应复用保存的目录句柄；不要求重新输入身份或选择目录。更换浏览器用户、清理站点数据或跨站点则无法直接访问原存储，需要恢复备份或重新授权。

回归检查：`tests/test_upgrade_identity.cjs` 验证更换本地目录及入口文件名后的身份继承；`tests/test_setup_flow_ui.cjs` 验证新版本地址复用目录句柄和完整设置流程。
