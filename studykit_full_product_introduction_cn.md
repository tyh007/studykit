# StudyKit 完整版产品介绍

版本: 1.0  
作者: Yh T  
日期: 2026-05-15  
适用场景: 产品说明、项目介绍、官网文案、pitch deck 基础稿、PRD 前言、开发团队 onboarding 文档  

## 一句话介绍

**StudyKit 是一款面向大学生的下一代综合学习工作台，帮助学生把 lecture slides、课堂笔记、批注、公式、多媒体、文献、flashcards、思维导图、代码笔记和 AI 复习材料整合到一个可同步、可导出、可扩展的学习系统中。**

它不是一个普通的笔记软件，也不是一个简单的 AI 总结工具。StudyKit 的核心目标是解决大学学习中最常见但长期被低估的问题：学生的学习资料被拆散在太多工具里，lecture slides 在一个地方，课堂笔记在一个地方，PDF 批注在一个地方，文献在 Zotero，flashcards 在 Anki，代码在 Jupyter 或 RStudio，复习材料又需要重新整理。StudyKit 试图把这些学习活动重新组织成一个围绕“课程、讲座、知识点和复习”的统一工作流。

## 产品愿景

StudyKit 的愿景是成为大学生的 **academic learning operating system**。它帮助学生从“被动保存资料”转向“主动构建知识”，从“碎片化工具切换”转向“结构化学习工作流”，从“临考前重新整理”转向“学习过程中持续生成复习材料”。

在 StudyKit 中，一门课不是一个文件夹，而是一个可以不断生长的知识空间。每一节 lecture 都可以包含 slides、个人 notes、Cornell cue notes、PDF 批注、handwriting、equations、readings、citations、flashcards、mind maps、code chunks 和 AI-generated study guides。每一类内容都不是孤立文件，而是有来源、有结构、有链接、有导出路径的学习对象。

长期来看，StudyKit 希望支持不同学科的学习方式：心理学学生可以按 method、findings、limitations、implications 整理研究；统计学学生可以在笔记中嵌入 R 或 Python code；医学学生可以从 diagrams 生成 flashcards；人文学科学生可以围绕 readings 和 citations 做主题笔记；计算机科学学生可以把 lecture explanation 和 notebook code 放在同一个学习文档里。

## 核心问题

### 大学生的学习资料天然是多格式的

大学学习很少只发生在一个 Word-like 文档中。学生需要处理 lecture slides、PDF readings、screenshots、handwritten notes、typed notes、figures、tables、statistical formulas、code chunks、recordings、Zotero references、Anki cards 和 revision guides。传统笔记软件通常只擅长其中一种或两种格式，导致学生必须在多个工具之间切换。

### Lecture slides 和个人笔记经常分离

许多课程以 slides 为核心展开，但学生的个人理解、例子、疑问和批注往往写在另一个软件里。复习时，学生需要重新对照 slides 和 notes，才能知道某句话对应哪一页、哪张图、哪位老师的解释、哪项研究或哪道考试重点。这种分离让复习效率明显下降。

### 传统笔记软件不适合复杂 academic workflow

OneNote、Notion、GoodNotes、Obsidian、Word、Anki、Jupyter、Zotero 等工具各有优势，但它们通常不是围绕 university study 的完整流程设计的。OneNote 支持自由笔记但导出和结构化较弱；Notion 适合数据库但 PDF annotation 和 pen support 不强；GoodNotes 适合手写但可扩展性和结构化导出有限；Obsidian 适合 Markdown knowledge management 但不适合 lecture slides annotation；Anki 专注 flashcards；Jupyter 和 RStudio 专注 computational work；Zotero 专注文献管理。学生真正需要的是把这些能力连接起来。

### AI 复习工具如果没有来源会不可信

很多 AI 学习工具可以快速总结内容，但如果它不知道课程语境、slides、老师重点、学生自己的 notes 和 readings，就很容易生成表面上流畅但不可靠的内容。对于大学学习来说，AI 输出必须能追溯来源，必须显示它根据哪些 slides、notes 或 citations 生成，不能让学生把 hallucinated content 当成考试材料。

### 导出和打印仍然非常重要

很多学生仍然需要把 notes 导出成 PDF、Word、Markdown、HTML、R Markdown、Quarto、Jupyter Notebook 或 flashcard decks。传统笔记软件经常把 export 当成附属功能，导致格式混乱、slides 和 notes 分离、图片缺失、公式错误、代码块损坏。StudyKit 把 export 视为核心体验。

## StudyKit 的解决方案

StudyKit 以“lecture-first academic workspace”为起点。它首先解决最真实、最普遍的大学学习场景：学生拿到一份 lecture slide deck，需要在上课时或课后把 slides、notes、批注、cue notes、equations 和 revision points 组织在一起。

在 Stage One 中，StudyKit 提供 advanced note-taking workflow：学生可以创建 module 和 lecture，导入 PDF slides，在 slides 旁边写 structured notes，使用 Cornell-style side notes，直接高亮和批注 slides，插入公式、图片、文件和 code-display blocks，并导出清晰的 PDF 或 Markdown。

在后续阶段，StudyKit 会逐步加入 academic sources、Zotero integration、AI revision、flashcards、mind maps、plugin SDK、external tool connectors、R Markdown / Quarto / Jupyter export，以及 group study 和 institutional workflows。

StudyKit 的关键不是一次性做完所有功能，而是从一套稳定的数据模型开始，让每一种学习对象都有结构、有来源、有导出方式、有同步机制，并能被未来 AI 和 plugins 安全地使用。

## 目标用户

### Lecture-focused university students

这类学生每天面对大量 lecture slides，需要在课堂上快速记录老师解释、案例、考试提示和自己的问题。他们最需要的是 slide-note integration、快速批注、清晰导出和复习结构。

### Tablet-first students

这类学生使用 iPad、Surface 或 Android tablet 搭配 stylus 学习。他们需要低延迟书写、highlighting、handwriting、PDF annotation、palm rejection 和可打印导出。StudyKit 要让 tablet 用户能够自然书写，同时保留结构化和可搜索能力。

### Research-heavy students

心理学、社会科学、人文学科、医学和研究型课程通常需要阅读大量 papers。StudyKit 通过 Zotero integration、citation insertion、reading lists 和 bibliography export，把 readings 与 lecture notes 连接起来。

### Revision-focused students

这类学生关注考试复习，需要把课程内容转化成 flashcards、study guides、mind maps、practice questions 和 active recall prompts。StudyKit 的 AI revision system 将帮助他们从已有 notes 和 slides 中生成可编辑、可追溯来源的复习材料。

### Coding and quantitative students

统计学、数据科学、心理学研究方法、计算神经科学、经济学和计算机科学学生需要在 notes 中处理 R、Python、SQL、Jupyter、Quarto 或 R Markdown。StudyKit 允许他们把 conceptual explanations 和 code chunks 放在同一套学习材料里。

### Power users

一些学生已经使用 Obsidian、Zotero、Anki、GitHub、Overleaf、RStudio、Jupyter 或 Notion。StudyKit 不应该封闭他们的 workflow，而应该通过 export、plugins 和 connectors 成为这些工具之间的学习中枢。

## 核心产品模块

### Module and lecture workspace

StudyKit 以大学课程结构为基础。用户可以创建 modules、lectures、topics、weeks 和 reading lists。每个 lecture 可以绑定 slides、notes、annotations、flashcards、AI summaries、citations 和 export jobs。这样学生不会只是在创建一堆孤立文件，而是在搭建一门课的知识结构。

### Slide-linked note-taking

StudyKit 的核心体验是把 slides 和 notes 放在同一个工作区中。用户可以在左侧查看 lecture slides，在右侧写 personal notes。每个 note block 都可以自动链接到当前 slide，因此复习时可以知道某段笔记对应哪一页 slides。

这个设计特别适合大学 lecture，因为老师通常围绕 slides 讲解，但真正的理解来自学生在旁边写下的解释、例子、疑问和总结。

### Cornell-style cue notes

StudyKit 支持 Cornell note-taking style。用户可以在 main notes 旁边添加 cue column，用于记录关键词、问题、考试提示、定义、active recall prompts 或 summary。这样一份 lecture note 可以自然转化成复习材料，而不需要临考前重新整理。

### Annotation and highlighting

用户可以直接在 slides 上高亮、下划线、画圈、写 comment 或用笔做 freehand annotation。StudyKit 不修改原始 PDF，而是把 annotations 作为 overlay 存储。这意味着原始文件保持干净，annotations 可以单独显示、隐藏、导出或同步。

### Structured academic blocks

StudyKit 的 note 不是一整块无结构文本，而是由不同 block 组成：

- Heading block。
- Paragraph block。
- List block。
- Callout block。
- Equation block。
- Image block。
- File attachment block。
- Code block。
- Citation block。
- Flashcard source block。
- AI-generated draft block。

这种 block-based model 让 StudyKit 可以更好地 export、search、sync、generate AI outputs 和支持未来 plugins。

### Equation and symbol support

很多大学课程需要数学、统计、逻辑或科学符号。StudyKit 支持 LaTeX-style equation input、visual rendering、symbol palette 和 export-preserved equations。它特别适合 statistics、research methods、cognitive science、neuroscience、economics 和 engineering 等课程。

### Multimedia and attachments

StudyKit 支持图片、文件、PDF snippets、datasets、audio references、screenshots 和 diagrams。用户可以把不同格式的学习材料嵌入到 notes 中，而不是把它们分散在不同文件夹里。

### Export engine

StudyKit 的 export engine 是核心模块。它从 structured blocks 和 source links 生成导出内容，而不是简单复制 editor HTML。Stage One 支持 PDF 和 Markdown，后续将支持 Word、HTML、R Markdown、Quarto、Jupyter Notebook、Anki-compatible flashcards、BibTeX、BibLaTeX、RIS 和 CSL JSON。

StudyKit 的导出目标包括：

- Printable lecture notes。
- Slide-plus-note PDF。
- Cornell revision sheet。
- Markdown archive。
- Obsidian-compatible vault。
- Study guide。
- Flashcard deck。
- R Markdown notebook。
- Quarto document。
- Jupyter Notebook。

### Local-first sync

StudyKit 必须支持 lecture-time reliability。学生不能因为教室 Wi-Fi 不稳定而丢笔记。因此 StudyKit 使用 local-first 思路：用户编辑先保存到本地，再后台同步到云端。系统需要 operation log、soft deletion、conflict preservation 和 sync status，确保 notes 不会被旧云端状态覆盖。

### Academic sources and Zotero

Stage Two 会加入 Zotero read-only integration。用户可以连接 Zotero library，把 collections 导入为 StudyKit reading lists，把 items 导入为 citation items，并在 notes 中插入 citations。之后 export 时可以生成 bibliography。

这个模块让 StudyKit 不只是课堂笔记工具，也能支持 research-heavy coursework、paper reading 和 literature-based revision。

### AI-grounded revision

StudyKit 的 AI 不应该是一个脱离课程内容的聊天机器人，而应该是 source-grounded revision assistant。用户选择 sources，例如某一节 lecture、几页 slides、一组 note blocks、一个 reading list 或 Zotero citations，AI 才能生成 study guide、flashcards、mind map 或 missing-content suggestions。

所有 AI 输出默认是 draft。用户必须 review、edit、accept 或 reject。每个 AI output 都保存 provenance，说明它来自哪些 notes、slides 或 citations。这样可以降低 hallucination 风险，也让学生保持主动学习。

### Flashcards and active recall

StudyKit 支持从 notes 手动或 AI-assisted 生成 flashcards。Flashcards 可以链接到原始 note block、slide page 或 citation source。未来可以支持 spaced repetition、Anki export、cloze deletion 和 image occlusion。

### Mind maps and whiteboard

StudyKit 将支持 mind maps 和 freeform whiteboard，用于概念关系、模型图、实验流程、理论框架和复习结构。Mind map nodes 可以链接到 source notes 或 citations，避免成为孤立图形。

### Coding and computational study

Stage Five 支持 enhanced code blocks、dataset attachments、R Markdown export、Quarto export 和 Jupyter Notebook export。StudyKit 不需要成为完整 IDE，但它应该让学生把 conceptual notes、statistical formulas、code examples 和 interpretation 放在同一份学习材料里。

### Plugin SDK and external connectors

StudyKit 的长期扩展能力来自 permissioned plugin system 和 external connectors。它可以借鉴 Obsidian-like plugin model，但需要更严格的 permission control。Plugins 可以注册 commands、views、export adapters、custom block types、AI transforms 和 importers，但不能默认访问所有 notes、不能默认访问网络、不能绕过用户授权。

External connectors 可以连接 Zotero、Anki、Google Drive、OneDrive、Canvas、Moodle、GitHub、Overleaf、Notion、Obsidian 和 Calendar。每个 connector 都需要明确 sync direction、permissions、audit log、disconnect flow 和 conflict policy。

## 典型使用场景

### 场景一: 上课时做 lecture notes

学生打开 StudyKit，进入某门 module，创建本周 lecture，上传老师给的 PDF slides。上课时，slides 显示在左侧，notes 显示在右侧。老师讲到某一页时，学生可以在旁边写解释、例子和疑问，也可以直接 highlight slide 上的重要图表。

如果老师提到“这个 concept 很可能出现在考试里”，学生可以在 Cornell cue column 写一个 active recall question。课后导出时，这些 cues 可以成为复习问题。

### 场景二: 课后整理和补充笔记

课后，学生重新打开 lecture workspace，查看哪些 slides 没有对应 notes，哪些地方被标记为 confusing。StudyKit 可以显示 note density 或 missing-content suggestions，帮助学生补全理解。

学生可以插入额外图片、公式、reading references 或自己的总结，并把 lecture 导出为 PDF 复习材料。

### 场景三: 阅读 paper 并连接课堂内容

学生连接 Zotero，把某门课的 reading list 导入 StudyKit。在 lecture notes 中，当某个理论或研究被提到时，学生可以插入 Zotero citation，并把 paper 的 method、findings、limitations 和 implications 写成 structured notes。

之后导出 revision guide 时，StudyKit 可以自动包含引用过的 references。

### 场景四: 生成复习材料

考试前，学生选择一个 topic 或 module，要求 StudyKit 根据 selected lectures、notes、slides 和 readings 生成 study guide。AI 输出不会直接覆盖 notes，而是作为 draft study guide 出现。学生可以检查 sources、修改内容、删除不准确部分，并接受最终版本。

同样，学生也可以从 notes 中生成 flashcards 或 mind map，并逐个 review。

### 场景五: 统计或编程课程

在 research methods 或 statistics lecture 中，学生可以在 notes 中写 R code 或 Python code，解释模型、变量和结果。之后可以导出为 R Markdown、Quarto 或 Jupyter Notebook，在 RStudio 或 Jupyter 环境中继续使用。

这让 StudyKit 同时支持 conceptual learning 和 computational practice。

## 产品阶段路线

### Stage One: Advanced lecture note-taking

Stage One 已完成或作为 MVP 核心：

- Module and lecture hierarchy。
- PDF slide import。
- Slide-note split layout。
- Cornell cue column。
- Structured note blocks。
- Annotation and highlighting。
- Equation support。
- Attachments。
- Local autosave。
- Conflict-safe sync foundation。
- PDF export。
- Markdown export。
- Future hooks for Zotero、plugins、AI、flashcards、mind maps 和 computational export。

Stage One 的目标是证明最核心的 lecture-note workflow 成立。

### Stage Two: Academic sources and Zotero

Stage Two 让 StudyKit 支持 academic sources：

- Zotero read-only connection。
- Zotero collections as reading lists。
- Zotero items as citation items。
- Citation insertion。
- Bibliography export。
- Source-linked note blocks。
- Connector sync events。

这一阶段让 StudyKit 更适合 psychology、social science、humanities 和 research-heavy courses。

### Stage Three: AI-grounded revision system

Stage Three 加入 AI revision：

- Source-scoped generation。
- Study guide drafts。
- Flashcard drafts。
- Missing-content detection。
- Schema-based extraction。
- Mind map drafts。
- Provenance and confidence labels。

这一阶段的关键不是“让 AI 替学生学习”，而是让 AI 帮学生把已有材料转化成更适合复习的结构。

### Stage Four: Plugin SDK and external-tool ecosystem

Stage Four 开放扩展能力：

- Plugin manifest。
- Permission grants。
- Command API。
- View API。
- Export adapter API。
- Custom block API。
- Developer mode。
- Internal plugin gallery。

长期来看，不同学科可以有不同插件，例如 psychology study schema、Anki exporter、APA table generator、statistics notebook exporter、case brief formatter、lab report planner 等。

### Stage Five: Coding and computational study

Stage Five 支持 coding-heavy modules：

- Enhanced code blocks。
- Dataset attachments。
- R Markdown export。
- Quarto export。
- Jupyter Notebook export。
- Plot and output blocks。
- Reproducibility metadata。

这一阶段让 StudyKit 更适合 quantitative methods、data science、computational psychology 和 computer science。

### Stage Six: Collaboration and institutional workflows

Stage Six 支持 collaboration 和 university-level workflows：

- Share personal notes without slides by default。
- Revocable sharing links。
- Group study workspaces。
- Comments。
- Optional real-time collaboration。
- LMS import。
- Institutional policies。
- Audit logs。

这一阶段必须最后做，因为它涉及版权、隐私、权限、sync 和 institutional compliance。

## StudyKit 的差异化

### 与 OneNote 相比

StudyKit 更重视结构化、source links、export quality、academic workflows 和 future AI grounding。OneNote 适合自由记录，但 StudyKit 更适合围绕 lecture slides、课程、文献和复习材料构建学习系统。

### 与 GoodNotes 相比

GoodNotes 强在 handwriting 和 PDF annotation。StudyKit 不仅支持 annotation，还支持 structured typed notes、Cornell cues、export pipeline、Zotero、AI revision、code blocks 和 plugins。

### 与 Notion 相比

Notion 强在 databases 和 flexible pages，但对 PDF slide annotation、pen workflow、lecture-note integration 和 academic export 的支持不是核心。StudyKit 从大学学习工作流出发，而不是从 general productivity 出发。

### 与 Obsidian 相比

Obsidian 强在 Markdown、backlinks 和 personal knowledge management。StudyKit 会保留 Obsidian-compatible export 和 plugin inspiration，但更重视 lecture slides、PDF annotation、tablet use、structured exports、AI provenance 和 academic sources。

### 与 Anki 相比

Anki 是优秀的 flashcard 工具，但它不是完整 note-taking 或 lecture workspace。StudyKit 可以生成和管理 flashcards，并在未来导出到 Anki，同时保留 flashcards 与原始 notes、slides 和 citations 的链接。

### 与 Zotero 相比

Zotero 是文献管理工具，不是课堂笔记系统。StudyKit 不替代 Zotero，而是把 Zotero references 接入 lecture notes 和 revision workflow。

### 与 ChatGPT 类 AI 工具相比

通用 AI 工具可以解释和总结，但往往缺少课程结构、用户 notes、slides 和 citations 的精确上下文。StudyKit 的 AI 应该是 source-grounded、draft-first、provenance-based 的学习助手。

## 技术理念

### Block-based academic object model

StudyKit 的内部不是一个普通文档，而是一组 academic objects。每个 note block、annotation、citation、flashcard、AI output、mind map node 和 code chunk 都有 stable ID、metadata、source links 和 export hints。

这种结构让 StudyKit 能够支持：

- Search。
- Sync。
- Export。
- AI grounding。
- Plugin extension。
- Zotero linking。
- Obsidian-compatible Markdown。
- Computational notebook export。

### Local-first reliability

StudyKit 的用户场景经常发生在 lecture hall、library、train 或 Wi-Fi 不稳定的地方。因此编辑必须先本地保存，再同步到云端。系统不能因为网络失败而丢 notes，也不能用旧 cloud state 覆盖本地新内容。

### Source-grounded AI

StudyKit 的 AI 应该围绕用户选择的 sources 工作，而不是凭空回答。每个 AI output 都应该保存 provenance，说明它来自哪些 notes、slides、citations 或 readings。

### Permissioned extensibility

StudyKit 的 plugins 和 connectors 必须 permissioned。插件不能默认读所有 notes，不能默认访问网络，不能默认调用 AI，不能绕过 export pipeline。这样才能在开放生态和用户数据安全之间取得平衡。

### Export as first-class feature

StudyKit 的每个内容类型都必须思考 export。学生必须能够把自己的材料带走，不应该被 lock-in。PDF、Markdown、Obsidian-compatible vault、R Markdown、Quarto、Jupyter、Anki 和 citation formats 都是长期方向。

## 商业和用户价值

### 对学生的价值

- 减少工具切换。
- 让 slides 和 notes 连接。
- 提高课堂记录效率。
- 提升复习质量。
- 更容易生成 flashcards 和 study guides。
- 支持 academic citation workflow。
- 支持 coding-heavy modules。
- 保留数据可导出性。

### 对大学或教育机构的价值

- 帮助学生建立更好的学习习惯。
- 支持 accessible learning workflows。
- 可与 LMS、reading lists 和 institutional tools 连接。
- 为 learning analytics 和 student support 提供未来可能性，但必须保护隐私。

### 对高级用户的价值

- 支持 Markdown 和 Obsidian-compatible workflows。
- 支持 Zotero。
- 支持插件。
- 支持 computational exports。
- 支持自定义 study schemas。

## 产品边界

StudyKit 不应该变成一个失控的 everything app。它必须坚持几个边界：

- 不替代所有工具，而是连接关键 academic workflows。
- 不把 AI 输出当作真实知识。
- 不默认公开分享 lecture slides。
- 不默认写回外部工具。
- 不让插件默认访问所有数据。
- 不牺牲 export 和 data ownership。
- 不为了功能数量牺牲 lecture-note 核心体验。

## 长期愿景

StudyKit 最终可以成为学生整个大学学习过程的个人知识系统。它不仅保存材料，还理解材料之间的关系；不仅帮助记录课堂内容，还帮助转化为复习材料；不仅支持 typed notes，还支持 handwriting、slides、citations、code、flashcards、mind maps 和 external tools。

长期的 StudyKit 可以拥有一个开放但安全的插件生态，不同学科可以构建自己的 study templates 和 workflows。心理学学生可以使用 research study extraction schema；医学学生可以使用 anatomy flashcard plugin；法学学生可以使用 case brief workflow；统计学生可以使用 R Markdown exporter；人文学科学生可以使用 citation-heavy reading notebook。

StudyKit 的理想状态不是让学生依赖 AI，而是让学生更清楚地看到自己学过什么、理解了什么、遗漏了什么、该如何复习，以及自己的知识如何从 slides、readings 和 notes 中逐步构建出来。

## 推荐官网短版文案

StudyKit is a lecture-first academic workspace for university students. Import slides, take structured notes beside them, annotate with pen or keyboard, add equations and media, connect readings from Zotero, and export everything into clean revision materials. With source-grounded AI, StudyKit helps you turn your notes into study guides, flashcards, mind maps, and coding notebooks without losing control of your own knowledge.

## 推荐中文短版文案

StudyKit 是一款面向大学生的综合学习工作台。你可以导入 lecture slides，在旁边写结构化笔记，添加 Cornell cue notes、批注、公式、图片、文献引用和代码块，并把内容导出成 PDF、Markdown、R Markdown、Jupyter Notebook 或复习卡片。未来的 AI 功能会基于你的 notes、slides 和 readings 生成可追溯来源的 study guides、flashcards 和 mind maps，帮助你更高效地复习，而不是替你学习。

## 推荐 tagline

- **StudyKit: Turn lectures into knowledge.**
- **StudyKit: From slides to study guides.**
- **StudyKit: Your academic workspace for notes, sources, revision, and code.**
- **StudyKit: 把课堂资料变成真正可复习的知识系统。**
- **StudyKit: 不只是记笔记，而是构建你的课程知识库。**

