# StudyKit v0.4 视觉方向与双主题规范

> 版本：0.4.0-draft  
> 日期：2026-07-20  
> 状态：实现基线已冻结；进入工程后仍需用真实界面截图完成 light/dark 视觉 QA  
> 依据：现有 `frontend/src/styles/liquid-glass.css`、`frontend/src/index.css`、Logo、Icons 与 Canvas 组件

---

## 0. 视觉决策

v0.4 不另起一套陌生品牌。正式视觉方向为：

> **Warm Cognitive Glass / Living Workspace**  
> 一个温暖、安静、具有空间感的学习与研究工作台。浅色模式像柔和纸张与自然日光，深色模式像夜间酒红研究室；AI、来源、协作与状态自然融入对象附近，而不是堆叠成仪表盘。

这意味着：

- 延续当前暖色奶油、玫瑰灰、腮红、淡紫与酒红视觉身份；
- Light 与 Dark 是平等的一等主题，不是简单反色；
- 保留轻量 Liquid Glass，但只用于浮层、工具条、侧栏和需要层级的表面；
- 内容本身优先使用干净基底、留白、排版和空间关系；
- 视觉简约不等于功能隐藏，复杂能力通过 progressive disclosure 出现；
- AI 不使用强烈霓虹、机器人形象或独占配色；
- Canvas 保留人的空间记忆，不因 AI 自动美化而频繁重排。

## 1. 当前视觉事实

现有代码已经定义了两个明确主题：

| 语义 | Light | Dark |
|---|---|---|
| Base | `#FBF6EE` 奶油纸张 | `#1C1216` 酒红黑 |
| Primary | `#C8A0A4` 暖玫瑰灰 | `#D4A8A8` 暖桃玫瑰 |
| Text | `#3A2E2E` 暖深褐 | `#E8DFD8` 奶油白 |
| Text secondary | `#6B5858` | `#B5A8A0` |
| Butter | `#F5E5BE` | `#D8B884` |
| Blush | `#F2D5D2` | `#C49898` |
| Rose | `#E5B8B0` | `#A87474` |
| Lilac | `#DCC8DC` | `#9C7CA8` |
| Success | `#8AB49A` | `#7AA68A` |
| Error | `#D88A7A` | `#C8806E` |

昨天看到的是 `prefers-color-scheme: dark` 自动生效后的 Dark 状态，不能代表 Light 主题。

### 1.1 当前需要修正的主题能力

现有 CSS 主要依赖系统媒体查询；`WorkspaceSettings` 已有 `system | light | dark` 类型，但 UI runtime 尚未形成完整 contract。v0.4 实现时必须支持：

- `System`：跟随操作系统并响应运行时变化；
- `Light`：用户显式固定浅色，不受系统影响；
- `Dark`：用户显式固定深色，不受系统影响；
- 主题选择保存在 workspace settings；登录前保存在 local preference；
- 首次渲染前应用主题，避免闪烁；
- Web 和 Desktop 共享同一 token contract。

推荐 CSS contract：

```text
:root / [data-theme="light"]  → Light tokens
[data-theme="dark"]          → Dark tokens
无显式 data-theme            → prefers-color-scheme
```

不要在组件中根据主题写条件颜色；组件只消费 semantic tokens。

## 2. 视觉层级

### 2.1 五层表面

| 层级 | 用途 | 视觉表现 |
|---|---|---|
| Base | Reader、Canvas、Document、主内容 | 主题基底 + 极弱背景 wash，不加容器边框 |
| Sunken | 输入区域、secondary wells、private scratch | 比 Base 略收暗/收暖，不使用阴影 |
| Surface | Sidebar、轻量 inspector、table header | 半透明或实体等价面，单分隔线 |
| Floating | Intent Capsule、selection actions、context menu | `glass-liquid-floating`，清晰边界，Depth 2 |
| Deep | Modal、permission preview、conflict review | `glass-liquid-deep`，Depth 3，背景轻 blur |

不能把每个 section 都做成 `.glass-card`。优先级是：

```text
留白与对齐 → 字体层级 → 分隔线 → surface tint → border → shadow
```

### 2.2 Glass 使用边界

适合：

- Intent Capsule；
- Canvas toolbar / selection toolbar；
- Sidebar / header；
- collaborator popover；
- modal / command palette；
- floating source preview。

不适合：

- 长文正文的每个段落；
- Table 的每一行；
- Canvas 的所有节点叠加多层玻璃；
- Project Home 的每一个信息区；
- 仅为装饰创建的空卡片。

## 3. 排版与密度

### 3.1 字体

- UI：`Inter`, system fallback；
- Code / identifiers：`JetBrains Mono`, `SF Mono` fallback；
- 不在 v0.4 引入第三字体；
- 学术 PDF/导出字体独立于 UI，不改变应用字体系统。

### 3.2 建议字号

| 角色 | 大小 | 行高 | 用途 |
|---|---:|---:|---|
| Display | 28–32 | 1.2 | Project/Course 当前核心问题，低频 |
| H1 | 22–24 | 1.25 | 页面标题 |
| H2 | 18–20 | 1.3 | 主要 section |
| Body | 14–16 | 1.5–1.65 | 正文、Evidence、Notes |
| UI | 13–14 | 1.4 | Buttons、tabs、labels |
| Meta | 11–12 | 1.35 | locator、provenance、timestamps |

长文阅读列控制在约 60–75 个英文字符；研究对象摘要不超过 8 行，超出时进入 Focus View。

### 3.3 间距

使用 4px 基础网格：`4 / 8 / 12 / 16 / 24 / 32 / 48`。主内容区默认 24–32px；紧凑工具条 8px；触控目标不小于 40×40px。

## 4. 形状、边界与图标

- `6px`：小控件、inline status；
- `8px`：inputs、compact buttons；
- `12px`：nodes、inspectors；
- `16px`：side panels、floating toolbars；
- `20px`：modal、Intent Capsule；
- pill 只用于 status、context chip、compact toggle，不把普通按钮全部做成胶囊；
- 图标继续复用 `frontend/src/components/ui/Icons.tsx` 的圆角线性语言；
- 新图标应使用 `currentColor`，不内嵌不可主题化颜色；
- 不使用 emoji 代替产品图标；
- 图标按钮必须有 accessible name 和 tooltip。

## 5. 核心表面构图

### 5.1 App Shell

- 56px 顶栏继续作为基线；
- 左侧是 workspace / mode / container 层级，不同时铺开全部功能；
- 中间主内容是视觉主角；
- 顶栏保留 Mode switch、Global Capsule 入口、sync/offline 和用户/设置；
- Sidebar 可收起、可调宽、按 Container 恢复；
- AI 不占据永久右侧栏。

### 5.2 Project Home：Living Brief

首屏层级固定为：

1. Research Question / working title；
2. `Resume last view` 主动作；
3. 当前 evidence → claim → decision 状态；
4. 一个 Next decision / blocked item；
5. 团队 review / mentions，仅在存在时出现；
6. Library、Canvas、Design、Output 作为次级入口。

不使用 KPI dashboard；不显示没有行动意义的论文数量、节点数量和完成百分比。

### 5.3 Course Home

首屏优先：最近 Lecture、待理解的问题、最近资料、可选 Review。课程周数和完成度为次级信息，不制造学习压力。

### 5.4 Reader

- PDF / slides / document 占主要宽度；
- Notes / Evidence inspector 可折叠；
- selection actions 紧贴选区，Intent Capsule 在需要时展开；
- source locator 始终可见但不抢正文；
- AI 短结果最大占视口 40%，更复杂结果进入临时 workspace。

### 5.5 Canvas

- 空间主表面使用低噪声背景；
- 第一层 toolbar 只显示 Capture、Connect、Focus、AI；
- Paper、Evidence、Claim、Question、Task 使用文本标签 + 轻量结构差异，不只靠颜色；
- Private Scratch 使用低对比区域标记和文字说明；
- Shared presence 使用低饱和颜色，避免多人光标成为视觉噪声；
- AI candidate relation 使用虚线/`Draft` label，接受后才成为正式关系；
- Minimap、zoom、scene 控件组合为紧凑 cluster。

### 5.6 Universal Intent Capsule

视觉结构固定为：

```text
[Context chips] [Private/Shared] [Provider]
[Intent input................................] [Run]
[最多 3 个 contextual actions]
[Scope / Draft / source status]
```

- 默认宽度 420–560px，窄屏适配到视口边距 16px；
- 单行状态收起时不超过 48px 高；
- 不使用强烈渐变边框或持续发光；
- AI 识别来自 Spark icon、`AI` label 与 provenance，不只依赖颜色；
- generating 使用安静的进度变化，不使用拟人打字动画；
- 用户连续输入时自动收起到非遮挡状态。

### 5.7 Collaboration

- Presence avatars 最大显示 3 个，更多使用 `+N`；
- 头像不是必需，可使用 initials；
- Comment anchor 使用小标记 + 数量，打开后进入 Floating surface；
- Private / Shared 状态必须同时有文字和 icon；
- Viewer / Commenter / Editor 的禁用状态解释原因；
- Activity 使用普通列表，不做社交 feed。

## 6. 语义颜色

颜色负责辅助区分，不负责单独表达含义：

| 语义 | 建议 token | 额外编码 |
|---|---|---|
| AI Draft | primary/lilac subtle | Spark + `Draft` + 虚线边界 |
| Verified Evidence | success subtle | Check + locator |
| Question / unresolved | butter/warning subtle | `?` icon + label |
| Conflict / opposing | error subtle | relation label + pattern |
| Private | neutral sunken | Lock + `Private` |
| Shared | primary subtle | People + `Shared` |
| Offline | muted | Offline icon + text |
| Running | info/primary | progress + Cancel |

Canvas 节点自定义颜色可以保留，但对象角色、verification 和 visibility 不能被自定义颜色覆盖。

## 7. Light 与 Dark 的差异

### 7.1 Light：Day Study

- 以 `#FBF6EE` 为纸张基底；
- background radial 只提供很弱环境感；
- surface 使用暖白半透明，边界轻；
- 文字以暖深褐为主，避免纯黑；
- 奶油/腮红/lilac 用于局部认知标记；
- 阴影保持极轻，避免“漂浮卡片墙”。

### 7.2 Dark：Night Research

- 以 `#1C1216` 为酒红夜间基底，而不是纯黑；
- surface 向深梅色分层；
- 正文使用奶油白，secondary 使用暖灰；
- primary 提亮到 `#D4A8A8`；
- 背景光晕更克制，避免低光环境眩光；
- 不使用大面积白色 modal；
- `text-muted` 只用于装饰性/非关键 meta，不能承载主要说明。

### 7.3 两个主题必须保持一致的内容

- 信息层级；
- component size 与 spacing；
- 交互状态；
- AI / Draft / Private / Shared 语义；
- keyboard focus；
- reduced motion；
- Canvas spatial positions。

切换主题不得引发布局跳动或 Canvas 重排。

## 8. 状态与动效

- hover/focus：150ms；
- panel/capsule：250ms；
- 大范围布局预览：最多 400ms，且可关闭；
- loading 优先使用局部 skeleton / progress，不对整屏 shimmer；
- saving 状态不阻断输入；
- success toast 只用于用户需要确认的跨位置动作；
- error 保留原内容和操作入口；
- `prefers-reduced-motion` 下所有非必要动画接近即时；
- AI layout 必须 before/after preview，不直接播放“魔法整理”。

## 9. 可访问性 Gate

- Light 和 Dark 分别验证 WCAG AA；
- 正文、控件与 placeholder 单独测量，不因玻璃背景假设固定对比度；
- focus ring 在两个主题都清楚，不能只依靠 glow；
- 关键文字不使用 `text-muted`；
- 所有状态使用 icon/label/pattern 的至少一种额外编码；
- 200% zoom 下主流程无水平页面滚动，Canvas 工具条允许内部滚动；
- keyboard 与 screen reader 可完成 Capsule、Reader、Review 和 Comments；
- Canvas 提供 Outline/List 等价视图。

## 10. 视觉反模式

禁止：

- AI 永久右侧聊天栏；
- 主页 KPI 卡片矩阵；
- 每个对象一张重阴影玻璃卡；
- 过多 gradient、glow、blur 或彩色边框；
- 为“AI 感”引入蓝紫霓虹；
- 浅色/深色直接 invert；
- 在组件中硬编码 `#fff` / `#000` 作为主要表面；
- 用颜色单独表达 Evidence、Claim、Private 或错误；
- 自动重排破坏 Canvas 空间记忆；
- 拟人助手头像、气泡轰炸、强制下一步。

## 11. 实现与视觉 QA 要求

每个新核心页面完成时必须提供：

1. Light 1440×1024 截图；
2. Dark 1440×1024 截图；
3. 1024×768 或等价紧凑桌面截图；
4. Empty、Normal、AI Draft、Offline/Error 至少四个状态；
5. keyboard focus 状态；
6. 与本规范的偏差说明。

视觉 QA 顺序：层级 → 密度 → 溢出/裁切 → 排版 → 对比度 → 边界/圆角 → 动效。不能只凭“看起来差不多”合并。

## 12. 冻结与未冻结

已经冻结：

- Warm Cognitive Glass / Living Workspace 方向；
- Light / Dark 双主题色彩基础；
- 主题 runtime 三态；
- 表面层级、排版、圆角、图标语言；
- Project/Course Home、Reader、Canvas、Intent Capsule 的构图原则；
- AI、Draft、Private/Shared 的视觉语义；
- 双主题 QA Gate。

尚未冻结：

- 每个页面的像素级布局；
- 具体插画/空状态资产；
- 移动端视觉；
- Light/Dark 中少数 semantic token 的最终对比度微调。

这些未冻结项不阻塞 P0 工程，但必须通过真实截图和可用性测试在合并前收敛。

