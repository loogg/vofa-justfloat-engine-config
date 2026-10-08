# Product

<!-- impeccable:product-schema 1 -->

## Platform

Windows Electron desktop

## Users

面向需要把设备二进制采样协议接入 VOFA+ 的开发者。产品是 Windows Electron 桌面工具，开发审查通过真实本地 Bridge 完成。

## Product Purpose

通过拖放协议积木、配置数据映射，生成并构建独立的 VOFA+ Qt 数据引擎。

## Capabilities and Constraints

- 固定结构协议的帧长由配置决定，运行时不会随字段值变化；编辑结构后重新计算长度。
- 帧结构由帧头、数据域、校验和可选帧尾组成；所有数据积木直接位于一级主画布，不需要子流程或流程模板。
- Word 始终占用 4 字节，其内部字节/位映射在属性面板配置。独立字段按实际宽度排列，固定结构协议允许两者混排。
- 完整 JustFloat 作为独立协议预设，保留原有帧尾扫描、图片帧、对齐和动态后续 Word 行为。旧配置保持兼容。
- 所有输出写入 QVector<float>；保留超过 24-bit 整数精度提示。
- Renderer 通过 backendApi 使用真实 Backend Service，保持 Electron 隔离与开发 Bridge 权限边界。
- 协议编辑使用原版 Node-RED editor-client：模块栏、网格画布、节点端口与连线、属性抽屉、缩放及撤销重做。外围工程设置和构建界面继续使用紧凑 Fluent 2 / Windows 11 风格。
- Node-RED 仅提供编辑器组件；生成与编译继续通过本项目 Backend Service，不启动 Node-RED 运行时或执行其通用节点。

## Product Principles

- 字段宽度和连线决定字节占用，结构变化后即时显示帧长。
- 拖放与键盘/点击操作都能完成核心配置任务。
- 配置保存、试解析、生成和实际插件的规则一致。
- 模式切换确认替换当前画布；节点与映射编辑使用原生撤销/重做。
- 开发、真实浏览器审查、Qt 构建和插件验收形成闭环。
