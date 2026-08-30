# JustFloat 自定义数据引擎生成器

这是一个独立的 Electron 配置工具。它负责可视化编辑每个 4 字节数据字的通道布局，并调用仓库内的生成/构建逻辑；Qt 工程仍只包含最终的数据引擎实现。

## 运行

需要 Windows x64、Node.js/npm，以及可用的 Qt 5.14.2 MSVC2017 64-bit Release 构建环境。

```powershell
cd tools\justfloat-engine-builder
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

一个原 JustFloat 浮点通道仍占用并按 4 字节对齐，但现在可以在这 4 字节内配置 `bit`、`uint8`、`uint16`、`uint32` 或 `float` 字段。用户只需填写一个英文引擎名称，工具会确定性派生显示名、qmake target、C++ 类名、插件 IID、DLL 与 JSON 文件名。三语 `format`、`example`、`url` 描述都可以在界面中编辑。

“生成”只创建或更新自定义 Qt 数据引擎源码；“Release 构建”会生成源码并调用 Qt/MSVC 工具链。生成源码与 `justfloat` 同级，运行产物仍遵循仓库现有的 `generated` 约定：

```text
dataengines/<targetName>/
dataengines/generated/<targetName>.json
dataengines/generated/win64/<targetName>.dll
```

配置可以保存为普通 JSON 文件，之后再从界面载入。构建命令的实时输出显示在界面的构建日志区域。

## 开发检查

```powershell
npm test
```

生成可单独发布的 Windows x64 便携 EXE：

```powershell
npm run dist
```

应用图标位于 `assets/app-icon.png` 和 `assets/app-icon.ico`；界面控件图标来自 Microsoft Fluent UI System Icons，第三方说明见 `THIRD_PARTY_NOTICES.md`。

渲染页面无法直接访问 Node.js。所有文件选择、生成和编译操作都通过受限的 preload API 交给 Electron 主进程完成。
