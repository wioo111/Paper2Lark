# cark

把论文变成可继续阅读、批注和沉淀的本地研究记忆工作台。

`cark` 把上传、解析、翻译、阅读、批注和沉淀收进同一个工作台。

- 上传 PDF
- 透明查看解析进度
- 选择本机或云端解析，并按需开启翻译
- 在本地阅读器里继续读、标、评、沉淀
- 把划线、评论和 Agent 回复沉淀为可确认、可回跳、可导出的研究记忆

## 核心体验

- 首页以研究状态和论文库为主，待确认记忆、最近判断、未解问题和全部论文保持清楚
- 可从本机 Zotero 只读选择 PDF；解析产物、阅读进度、译文和批注仍全部保存在 cark
- 任务过程实时可见，失败和中断任务可查看原因并重试
- 设置分为常用设置和高级设置，只在当前能力确实不足时提示；能力未就绪时上传入口会停用
- 阅读页支持整页滚动、浮动目录、原文/双语视图和句子级批注
- 阅读位置、当前视图和未提交批注草稿会自动恢复
- 评论线程支持回复、编辑、删除、归档、正文标记和 Agent 共读状态展示，失败时会明确提示
- 候选记忆必须经用户确认后才进入长期记忆；归档或删除后不会污染默认搜索
- 记忆搜索结果携带定位器，能回到论文、批注或记忆卡片
- 所有主流程都围绕本地阅读、证据和沉淀展开

## 为什么做它

- 读论文的过程常常被切碎在终端、网页、文档平台和脚本之间
- 解析完成之后，真正有价值的是继续阅读、批注和沉淀
- `cark` 想把这条链路收回本地，让“处理论文”和“消化论文”发生在一个地方

## 适合谁

- 想把论文长期留在本地工作台里继续处理的人
- 想把“解析、翻译、阅读、批注、沉淀”收进一个界面的人
- 不想在终端、网页和脚本之间来回跳的人

## GUI 里的几个关键术语

这些词会保留在设置页里，每个词都对应一个明确选择。

### 解析后端

- `local`：在你自己的机器上解析 PDF
- `cloud`：把 PDF 发到 MinerU 云端解析
- 重隐私、想离线：选 `local`
- 想省本地依赖、先快速跑通：选 `cloud`

### 解析模式

- `auto`：系统自动判断
- `txt`：适合原生文字型 PDF
- `ocr`：适合扫描件、截图件、影印件
- 不确定就用 `auto`
- 明确是电子原稿就用 `txt`
- 明显是扫描版就用 `ocr`

### 云模型版本

- `pipeline`：标准方案，默认优先
- `vlm`：增强视觉方案，适合复杂版面
- 先用 `pipeline`
- 复杂图表、复杂排版识别差时再试 `vlm`

## 快速开始

### 方式一：直接启动 GUI

```powershell
git clone https://github.com/wioo111/cark.git cark
cd cark
powershell -ExecutionPolicy Bypass -File .\install.ps1
cark gui
```

启动后会打开本地工作台，默认地址：

```text
http://127.0.0.1:8765
```

### 手机和平板阅读

Android 阅读器以离线文献包为默认入口，不要求手机连接电脑：

1. 单篇迁移可在论文卡片上点击“手机包”，导出 `.carkpaper`。
2. 整库迁移可在书架右上角点击“整库打包”，导出包含当前全部论文的 `.carklibrary`。
3. 通过微信、网盘、数据线或系统分享把文件发送到手机、平板或另一台电脑。
4. 在 Android App 中选择“导入文献包”；在另一台 cark 电脑点击“导入文献库”。导入后即可阅读。

文献包包含原文、已有译文、图片、目录、批注、标签与阅读位置，并在导入时校验格式、论文清单和资源完整性。`.carklibrary` 内仍使用标准 `.carkpaper`，因此手机和桌面端使用同一份迁移文件。连接电脑只作为可选同步方式。安装 APK、导入文献包和可选联网步骤见 [随身论文阅读器说明](docs/mobile-reader.md)。

Android 商店发布、签名、隐私政策和仍需发布者完成的材料见 [应用商店发布清单](docs/app-store-release.md)。

### 也可以继续用 CLI

CLI 适合批处理、调试和自动化。

```powershell
# 环境体检
cark doctor

# 启动 GUI
cark gui

# 直接处理一篇 PDF
cark upload "D:\path\to\paper.pdf" --backend cloud --translate

# 从已有 content_list.json 继续生成 docx
cark docx ".\runtime\output\<task-id>\<paper>\auto\<paper>_content_list.json"
```

### Demo smoke

不配置 MinerU、不配置 API key，也可以先验证研究记忆闭环：

```powershell
python .\cli.py demo
```

这个命令会在 `runtime/demo-smoke` 里创建隔离 demo：mock 论文、批注、Agent 评论、候选记忆、确认后的 active 记忆、搜索索引和 Markdown 导出。它不会修改真实论文库数据。

要在 GUI 中打开这套 demo 数据：

```powershell
python .\cli.py demo --gui
```

如果已经通过安装脚本注册了命令，也可以使用：

```powershell
cark demo --gui
```

Windows 安装、doctor、demo、GUI、Agent 设置和常见排障见 [docs/windows-usage.md](docs/windows-usage.md)。

## 技术取向

这个项目有几个明确立场：

- **GUI-first**：普通用户主流程都应该在 GUI 完成
- **CLI still matters**：CLI 继续服务批处理、调试和自动化
- **local-first**：优先保证本地可读、可控、可沉淀
- **透明处理**：上传后能看到过程，不用只等结果
- **Zotero 只读**：Zotero 只作为论文来源，cark 不写回或修改 Zotero 数据
- **证据优先**：研究记忆必须保留来源、证据片段和可回跳定位

## 仓库结构

```text
cli.py       命令行入口与任务编排
config/      可提交的配置模板
docs/        安装、使用、工程基线与交付说明
gui/         React 阅读工作台
scripts/     解析、翻译、导出与本地服务
runtime/     本地论文和运行产物，不进入 Git
```

任务、论文索引和阅读状态保存在 `runtime/cark.sqlite3`。现有论文、批注和配置文件继续原地使用，不需要迁移。

GUI 使用单实例锁保护运行中的任务。服务异常停止后，旧任务会显示为“已中断”；重复启动不会把现有任务误标为中断。论文文件移走后，失效索引会在刷新时清理，已有阅读状态与批注文件不会被删除。

使用 OpenAI 兼容翻译服务时，可在高级设置中同时配置 Base URL 和模型名称。

运行数据、凭据、本机配置和生成文件不要提交。`main` 是唯一长期分支，功能开发使用短期分支，合并后删除。

开发检查：

```powershell
cd gui
npm run lint
npm test
npm run build
npm run android:apk

cd ..
python -m compileall -q cli.py scripts
cark demo
```

## 当前阶段

它已经是一套能跑起来的本地论文工作台。

已完成的重点：

- GUI 上传与实时任务面板
- SQLite 任务、论文索引和阅读状态持久化
- 服务重启后的任务中断识别、历史任务展示和失败重试
- 常用设置 / 高级设置分层与本机能力检查
- 句子级批注阅读器
- 阅读位置、当前视图和批注草稿恢复
- 批注保存、编辑、归档和删除的错误反馈
- candidate → active → archived 的记忆审核流
- 从 Agent 结构化回复生成候选记忆，并在失败时降级为普通评论
- 首页研究工作台：待确认记忆、最近判断、未解问题
- 激活记忆进入默认搜索；候选和归档记忆不污染普通搜索
- 设置页可测试、复制、禁用并保留 Agent 配置；不完整的启用 Agent 不会进入共读入口
- 无 API key 的 demo smoke，可验证研究记忆闭环
- MinerU 本地 / 云端双后端接入
- 翻译采用结构化分块、格式校验和失败关闭，只有完整通过才发布双语稿
- Android 原生离线阅读器与可校验的 `.carkpaper` 文献包

接下来会继续推进：

- 全局提问入口与跨论文证据编排
