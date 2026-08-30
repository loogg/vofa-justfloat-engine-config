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

仓库根目录可在界面中选择，`dataengines` 目录会由所选仓库自动派生。生成、构建和“打开产物目录”始终使用同一个已校验仓库，因此打包后的独立 EXE 不必放在 Vodka 仓库中。

## 配置与产物

一个原 JustFloat 浮点通道仍占用并按 4 字节对齐，但现在可以在这 4 字节内配置 `bit`、`uint8`、`uint16`、`uint32` 或 `float` 字段。用户只需填写一个英文引擎名称，工具会确定性派生显示名、qmake target、C++ 类名、插件 IID、DLL 与 JSON 文件名。

- 通道区域按物理 `ch` 着色，并与 Word 节点和输出树双向联动。
- 输出通道以 Word 为父节点、ch 为子节点展示，可以折叠。
- `wordCount` 表示需要自定义解析的最小 Word 前缀，不再限制整帧长度；未配置的 Word 以及帧中更后面的 Word 都沿用 JustFloat，每个 Word 输出一个 `float` 通道。
- 三语 `format`、`example`、`url` 可以手工编辑。新配置默认随引擎名、Word 和通道布局在本机自动刷新简中、繁中和英文标准描述；开始手工编辑后会自动暂停同步，避免覆盖用户内容，也可随时重新启用。
- 自由文本不会发送到在线翻译服务；如需任意文案翻译，需要后续配置独立的翻译提供方。

“生成”只创建或更新自定义 Qt 数据引擎源码；“Release 构建”会生成源码并调用 Qt/MSVC 工具链。生成源码与 `justfloat` 同级，运行产物仍遵循仓库现有的 `generated` 约定：

```text
dataengines/<targetName>/
dataengines/generated/<targetName>.json
dataengines/generated/win64/<targetName>.dll
```

配置可以保存为普通 JSON 文件，之后再从界面载入。构建命令的实时输出显示在界面的构建日志区域；日志会逐行识别 UTF-8 与 Windows GB18030/GBK 输出，避免中文 MSVC 链接信息乱码。

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

渲染页面无法直接访问 Node.js。所有文件选择、生成和编译操作都通过受限的 preload API 交给 Electron 主进程完成。
