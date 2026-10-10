# VOFA+ 协议工作台

这是一个独立的 Electron 配置工具。前端直接使用 Node-RED 原生编辑器组件，在一级画布配置协议节点和连线；后端将协议转换为 VOFA+ Qt 数据引擎，并执行 Release 构建。

## 协议节点与画布

- 使用 Node-RED 原生模块库、网格画布、自由移动、端口连线、框选、缩放、平移、导航器、菜单、撤销/重做及属性编辑面板。
- 所有预设使用同一画布：`接收流 → 可选帧头 → 数据字段 / 值校验 → 可选 CRC → 可选帧尾 → VOFA+ 输出`。第一阶段使用顺序链，尚不支持 Switch 分支。
- 在接收流中选择“按字段结构定长”或“按帧尾结束”。无帧头协议必须配置帧尾；定长帧按已知偏移验证帧尾，变长帧扫描帧尾，可追加每 4 字节一个 float32 的后续 Word。
- 帧头匹配支持最多 32 个等长候选，属性面板每行填写一个 HEX 值，匹配任意一个；没有帧头时直接省略节点。
- 值校验引用连线前方的已读字段，支持等于、允许值集合、含边界范围和无符号位掩码。本节点不占字节，字段可关闭输出；Word 内的映射字段也可仅用于校验。
- 字段判断使用原始数值，早于 VOFA+ 的 float 转换。校验失败从候选帧起点后移 1 字节重新搜索；数据不足保留候选，等待后续字节。CRC 与帧尾失败也使用相同恢复规则。
- 左侧数据域模块直接拖入主画布，提供 4 字节 Word、定宽整数、float32、字节内状态位和保留字节；固定结构协议允许 Word 与其他定宽字段混排。
- 主画布的连线决定 Word / 字段物理顺序。双击 Word，在属性面板编辑 4×8 位映射；空映射默认输出 float32，不需要打开流程模板。
- CRC 支持 SMBUS、MAXIM、SAE-J1850、MODBUS、ARC、XMODEM、CCITT-FALSE、ISO-HDLC 预设及参数化 CRC-8/16/32。算法反射、校验范围和存储字节序分别配置。
- 数据测试通过真实 Backend Service 验证帧边界、校验和通道输出；支持半帧、多帧和噪声恢复。
- 配置保存节点位置、连线、字节序和字段映射。未连完的画布可作为草稿保存；只有验证通过的协议才能试解析或生成引擎。早期二级画布配置仍可读取，完整配置在编辑器中转为一级结构。
- JustFloat 是“无帧头 + 按帧尾结束 + 小端 Word + 后续 Word”的预设。预设默认勾选图片兼容，保留原有帧尾扫描、图片帧、4 字节对齐和动态后续 Word 行为；添加普通协议的值校验或非 Word 字段时，需在接收流中关闭图片兼容。
- 既有配置和生成器快照仍可载入，旧画布在完整时转换为统一接收流画布。协议预设只用于建立初始节点，不再按预设限制模块库。

可载入 `examples/validated-sensor.vofa-engine.json` 体验多值帧头、地址 / 命令校验和仅输出采样值。整数条件支持十进制与 `0x` 十六进制；试解析可自动填入满足条件的样例，失败信息会指出字段，CRC 信息单独显示。JustFloat 图片兼容预设也支持数据测试。

按帧尾结束时，帧尾序列视为保留分隔符，数据域中不能出现该序列；本阶段不支持转义或长度字段驱动的变长数据域。普通流候选整帧最多 65536 字节。

Node-RED 仅提供编辑器前端。产品不运行 Node-RED 流程服务器、不加载执行型节点或第三方运行模块；文件、目录、对话框、生成与构建仍由受限 `backendApi` 访问真实 Backend Service。原生编辑器的静态资源在 `npm ci` 后由同步脚本生成，进入发布包，但不作为依赖目录提交。

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

## JustFloat 兼容配置与产物

一个原 JustFloat 浮点通道仍占用并按 4 字节对齐，但现在可以在这 4 字节内配置 `bit`、`uint8`、`int8`、`uint16`、`int16`、`uint32`、`int32` 或 `float` 字段。有符号整数按小端补码解码。用户只需填写一个英文引擎名称，工具会确定性派生显示名、qmake target、C++ 类名、插件 IID、DLL 与 JSON 文件名。

- 应用 JustFloat 预设后，接收流后直接连接 Word 和帧尾；双击 Word 配置字节和位映射。
- 在画布中增减 Word、调整连线和字段映射，使用原生撤销/重做恢复编辑。工程设置里的数据域信息由画布推导。
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
node scripts/protocol_smoke.js
```

`protocol_smoke.js` 在 `scratch/` 中生成并编译 Qt 5.14.2 MSVC2017 x64 Release 插件，覆盖 Word / 自定义 / 混排数据域、全部 CRC 预设、自定义 CRC、无校验、多值 / 无帧头、字段校验与重叠帧头恢复、帧尾变长收帧及旧 JustFloat 解析。构建环境要求与桌面工具一致。

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

桌面窗口点击右上角关闭按钮时，已保存或未修改的配置可直接退出；存在未保存更改时会显示确认，可继续编辑或放弃更改后退出。关闭判断跟随工作台的配置保存状态，包含尚未同步到主界面的画布修改。Release 构建进行中会提示等待完成，保护 DLL 与 JSON 的成对提交。

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
