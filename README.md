# JustFloat 自定义数据引擎生成器

这是一个独立的 Electron 配置工具。它负责可视化编辑每个 4 字节数据字的通道布局，并调用仓库内的生成/构建逻辑；Qt 工程仍只包含最终的数据引擎实现。

## 运行

需要 Windows x64、Node.js/npm，以及可用的 Qt 5.14.2 MSVC2017 64-bit Release 构建环境。

```powershell
cd vofa-justfloat-engine-config
npm install
npm start
```

如果 Electron 二进制下载在国内网络环境中停滞，可在安装前设置镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install
```

工具会自动扫描 Qt 和 Visual C++ 构建工具。如果自动检测不到，可在构建环境窗口中分别选择 `qmake.exe`、`jom.exe` 和 Visual C++ 环境脚本（通常为 `vcvarsall.bat`）。构建时会使用 `x64 -vcvars_ver=14.16` 初始化 MSVC2017 环境，目标配置固定为 `Desktop_Qt_5_14_2_MSVC2017_64bit-Release`。缺失、版本不匹配或仓库结构不完整时会列出具体原因并阻止构建。

仓库根目录可在界面中选择，`dataengines` 目录会由所选仓库自动派生。另可选择 **VOFA+ 安装目录**（例如 `D:\VOFA+\x64`，包含 `plugins/dataengines`），Release 构建成功后会把同名 DLL 和 JSON 直接放入该目录的 `plugins/dataengines`。路径按本机记忆，也可清除以恢复仅输出到仓库；独立 EXE 不必放在 Vodka 仓库中。

## 配置与产物

一个原 JustFloat 浮点通道仍占用并按 4 字节对齐，但现在可以在这 4 字节内配置 `bit`、`uint8`、`int8`、`uint16`、`int16`、`uint32`、`int32` 或 `float` 字段。有符号整数按小端补码解码。用户只需填写一个英文引擎名称，工具会确定性派生显示名、qmake target、C++ 类名、插件 IID、DLL 与 JSON 文件名。

- 通道区域按物理 `ch` 着色，并与 Word 节点和输出树双向联动。
- 输出通道以 Word 为父节点、ch 为子节点展示，可以折叠。
- 缩减自定义解析 Word 数时，如果被移除的 Word 仍包含字段，工具会先确认删除范围和字段数量；仅移除空 Word 时直接生效。
- `wordCount` 只定义可自定义解析的 Word 范围，不限制整帧长度，也不是最小长度；短帧只解析实际存在且匹配到的 Word，未配置和更后面的 Word 都沿用 JustFloat，每个 Word 输出一个 `float` 通道。
- 三语 `format`、`example`、`url` 可以手工编辑。新配置默认随引擎名、Word 和通道布局在本机自动刷新简中、繁中和英文标准描述；开始手工编辑后会自动暂停同步，避免覆盖用户内容，也可随时重新启用。
- 自由文本不会发送到在线翻译服务；如需任意文案翻译，需要后续配置独立的翻译提供方。

“生成”只创建或更新自定义 Qt 数据引擎源码；“Release 构建”会生成源码并调用 Qt/MSVC 工具链。生成源码与 `justfloat` 同级，运行产物仍遵循仓库现有的 `generated` 约定：

```text
dataengines/<targetName>/
dataengines/generated/<targetName>.json
dataengines/generated/win64/<targetName>.dll
<vofaPath>/plugins/dataengines/<targetName>.json  （设置 VOFA+ 路径时）
<vofaPath>/plugins/dataengines/<targetName>.dll   （设置 VOFA+ 路径时）
```

配置可以保存为普通 JSON 文件，之后再从界面载入；也可以直接载入生成或构建时写入 `dataengines/<targetName>/.vofa-engine-builder.json` 的配置快照。`dataengines/generated/<targetName>.json` 仅供 VOFA+ 显示插件说明，不包含通道布局，不能作为配置载入。

载入和保存对话框首次默认打开当前所选仓库的 `dataengines` 目录，之后按仓库记住最近一次成功载入或保存的文件夹，重启后仍然有效。切换仓库时使用该仓库自己的记录；记录目录不存在时退回 `dataengines`。没有可用记录、且未选择仓库或其 `dataengines` 不可用时，使用“文档”目录。

构建命令的实时输出显示在界面的构建日志区域；日志会逐行识别 UTF-8 与 Windows GB18030/GBK 输出，避免中文 MSVC 链接信息乱码。

## 开发检查

```powershell
npm test
```

生成本地 Windows x64 发布包：

```powershell
npm run dist
```

输出目录包含：

```text
dist/VOFA_JustFloat_Engine_Config_x64_<version>_portable/
dist/VOFA_JustFloat_Engine_Config_x64_<version>_portable.zip
dist/VOFA_JustFloat_Engine_Config_x64_<version>_setup.exe
```

## 版本与 GitHub Release

- 版本唯一来源是 `package.json`。
- 创建并推送 `v<version>` tag 后，GitHub Actions 会自动测试和打包。
- GitHub Release 只包含 `portable.zip` 与 `setup.exe`，不上传 portable 文件夹。
- 版本规则和提交要求见 `AGENTS.md`。

项目主页：[loogg/vofa-justfloat-engine-config](https://github.com/loogg/vofa-justfloat-engine-config)

应用图标位于 `assets/app-icon.png` 和 `assets/app-icon.ico`；界面控件图标来自 Microsoft Fluent UI System Icons，第三方说明见 `THIRD_PARTY_NOTICES.md`。

Renderer 通过统一 `backendApi` 访问后端，与 Electron 解耦；原生模式使用受限 preload/IPC，开发 Browser 模式使用本地 Bridge，二者共用 `src/backend/service.js` 的真实文件读写、仓库校验、生成和构建逻辑。渲染页面不能直接访问 Node.js。

## Browser Review Mode 与验证

```powershell
npm ci
npm run review
```

在 Codex 内置浏览器打开终端显示的本机 URL（默认 `http://127.0.0.1:4173/?transport=bridge`）。地址栏明确标记传输模式，界面顶部显示“Bridge · 真实后端”；未指定参数的入口会自动跳转到带 `transport=bridge` 的地址。路径与打开/保存对话框在浏览器内输入本机完整路径，实际执行相同的磁盘操作。构建日志实时传回界面。可使用 `npm run review -- --port 4174` 更换端口。

目前只实现真实 Bridge；`transport=mock` 或其他不支持的值会明确报错，不会切换到 Bridge。以后新增 Mock/Fixture 时使用显式链接，例如 `?transport=mock&fixture=build-error`，并在界面显示对应模式和场景。URL 参数用于标记和选择开发传输模式；生产环境仍由打包排除和后端启动限制隔离。

Bridge 必须显式以开发模式启动，拒绝 `NODE_ENV=production`，仅监听 `127.0.0.1`，校验 Host、Origin、会话令牌和 API 白名单；Bridge 及其浏览器适配器不进入发布包。测试和审查过程文件统一保存在项目 `scratch/`。

UI 修改后必须实际审查 980×680、1306×781 及布局断点附近的尺寸，检查视觉、点击、输入、菜单、弹窗、滚动和相关 Empty / Loading / Error / Disabled 状态，修复后重新查看。Mock/Fixture 只用于难以稳定复现的特殊状态。自动化测试不能替代交互和视觉审查；原生文件/目录对话框、preload/IPC 和系统打开目录仍需在真实 Electron 应用中验证。

Release 构建先完成编译，再将仓库与 VOFA+ 的 DLL / JSON 一起提交；任何复制或替换失败都会回滚整组文件，避免旧 DLL 与新 JSON 错配。被 VOFA+ 占用的 DLL 需要退出 VOFA+ 后重试。

仅生成源码时，若已有 DLL，工具会保留与其配对的 JSON，待下一次 Release 构建成功后再一起更新。Qt 生成验证可使用示例配置构建 CustomFloat，然后运行 `node scripts/plugin_smoke.js <customfloat.dll 的完整路径>`。打包完成后自动检查三项产物、包内版本，以及开发 Bridge 是否被排除；也可运行 `npm run verify:version -- --artifacts` 单独检查。
