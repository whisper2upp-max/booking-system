# Booking System v3.5

离线排班与项目管理工具，支持 EIC 排班、项目总览、节点日历、预算、实际工时、Task 分工、人员主数据及数据备份恢复。

## 使用

1. 从 Releases 下载 `booking-system-v3.5.zip` 并完整解压。
2. 使用桌面版 Chrome 或 Edge 打开 `app/booking system v3.5.html`，所有依赖随包提供，无需联网。
3. 点击顶部“管理人员主数据”，下载模板，填写 Name、Email、Level、FIC、EIC 后导入。Level 使用下拉选项；姓名支持点号或空格。
4. 导入排班、预算等业务数据。顶部“使用说明”提供完整操作指引。
5. 选择自动备份文件夹。网页运行期间每两小时备份一次，最多保留五份；也可手动导出 JSON 或从备份恢复。

## 数据与隐私

仓库和 Release 不含人员名单、邮箱映射、实际项目数据或业务备份。人员主数据初始为空，所有用户数据由用户自行导入并保存在当前浏览器中。已有浏览器保存的主数据仍会保留。

私有仓库不是业务数据的备份位置。不要提交填写后的 Excel、人员信息、浏览器导出 JSON 或业务截图。空白模板仅包含表头；姓名和邮箱示例使用虚构名称与 `example.com`。

浏览器清除站点数据、更换浏览器或打开位置可能影响已有数据与目录授权。迁移前请导出完整 JSON 备份。自动备份要求浏览器支持目录读写，并保持网页运行。

## 文档

- [使用说明](使用说明_v3.5.md)
- [更新日志](更新日志_v3.5.md)

## 开发与构建

`src/workspace.jsx` 和 `src/project-overview.jsx` 为主要界面源码；`app` 包含离线运行文件。修改源码后执行：

```sh
python3 scripts/sync_workspace.py
node scripts/render_guide.cjs
python3 scripts/package_user_release.py
```

构建前会检查内置人员名单必须为空，输出目录为仓库同级的 `使用者分发/v3.5`，压缩包为 `booking-system-v3.5.zip`。

检查：

```sh
node tests/test_workspace_store.cjs
node tests/test_auto_backup.cjs
node tests/test_release_ui.cjs
```

浏览器测试需在开发环境提供 Playwright；普通使用者无需安装。测试仅使用虚构人员，不使用真实名单。
