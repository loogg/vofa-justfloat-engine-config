# AGENTS.md

本文件适用于 `justfloat-engine-builder` 仓库的全部目录。

## 项目定位

- 本项目是独立发布的 Electron/Node.js Windows 桌面工具。
- UI 负责可视化配置，Qt 代码仅作为生成的数据引擎源码。
- 工具生成的引擎源码位于用户所选 Vodka 仓库的 `dataengines/<target>/`；运行产物位于 `dataengines/generated/`。

## 技术与设计约束

- Electron 主进程使用 CommonJS，渲染进程保持 `contextIsolation: true`、`nodeIntegration: false`。
- 所有文件系统、构建、仓库和对话框操作都必须通过受限 preload/IPC 完成。
- UI 采用 Microsoft Fluent 2 / Win11 工程工具风格：紧凑、扁平、清晰、低装饰；不使用渐变、玻璃拟态、大型营销区或手绘 SVG。
- UI 图标优先使用 `assets/icons/` 中的 Microsoft Fluent UI System Icons。
- `uint32` 输出到 VOFA+ 的 `QVector<float>` 时可能损失超过 24-bit 的整数精度，界面和描述必须保留提示。
- 不能改变 JustFloat 的帧尾扫描、图片帧和 4 字节对齐逻辑；自定义解析只替换普通采样帧的字段解码。

## 版本号约定

- 根目录 `package.json` 的 `version` 是唯一版本来源。
- 新增功能或修改现有功能时，必须在同一次变更中按 Semantic Versioning 递增版本号。
- 不兼容变更递增主版本；向后兼容的新功能递增次版本；修复或行为调整递增修订版本。
- 纯文档、纯测试、格式化等不改变产品行为的变更可以不递增版本号。
- `package-lock.json` 根包版本必须与 `package.json` 完全一致。
- README、打包脚本、发布脚本不得硬编码不同版本；应读取 `package.json`。

## 验证要求

提交功能代码前至少运行：

```powershell
npm ci
npm test
node --check src/main.js
node --check src/preload.js
node --check src/generator.js
node --check src/renderer/renderer.js
```

- UI 变更必须验证 1306×781 和 980×680，不得出现页面级横向溢出、缺图或控制台错误。
- 数据引擎生成变更必须执行 Qt 5.14.2 MSVC2017 x64 Release 构建和 `plugin-smoke`。
- 构建失败不得让旧 DLL 与新 JSON 形成错配；运行产物必须成对提交或回滚。

## Git 与发布

- 完成一个相对独立且可验证的阶段后进行一次提交；提交信息简洁说明目的。
- 不提交依赖目录、缓存、日志、临时文件、本地构建目录或打包输出。
- 任何变更一旦修改根目录 `package.json` 的 `version`，任务范围自动包含完整发布闭环，不得只完成本地提交后停止。必须依次完成：
  1. 运行全部必需验证和版本一致性检查，确认工作树只包含预期变更；
  2. 运行 `npm run dist`，确认本地 `dist/` 精确产生下述三项同版本产物；
  3. 提交变更并将当前主分支推送到远端；
  4. 创建并推送精确指向该发布提交的 `v<package.version>` tag；
  5. 持续等待 GitHub Actions Release 工作流结束，不得在工作流仍运行时宣告完成；
  6. 确认 GitHub Release 已公开且为最新版本，并精确包含同版本的 `portable.zip` 与 `setup.exe` 两项资产。
- 本地验证、版本一致性检查或打包失败时不得推送版本 tag；tag 必须指向已推送到远端主分支的发布提交。
- 不得移动或复用已推送的版本 tag；发布后如需修改产品代码，必须再次递增版本号并创建新 tag。
- 发布 tag 使用 `v<package.version>`，例如 `v1.1.0`。
- 每个版本 tag 必须对应一个 GitHub Release。
- 本地 `npm run dist` 需要产生：
  - `<product>_x64_<version>_portable/`
  - `<product>_x64_<version>_portable.zip`
  - `<product>_x64_<version>_setup.exe`
- GitHub Release 只上传 `portable.zip` 和 `setup.exe`，不上传 portable 文件夹。
- 发布前必须运行版本一致性检查，并确认 tag、`package.json`、`package-lock.json` 和产物文件名版本相同。
