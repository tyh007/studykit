# StudyKit — Liquid Glass v3.1 暖色调设计语言

> 基于 v3 设计的颜色补丁。Liquid Glass 机制、Logo "Ink & Prism" 概念、Icon 规范、文件操作、测试、假设保持 v3 原状；只把品牌色 / 背景 / 暗色 / 资产 prompt 全部推到淡暖色调。

---

## 1. Brand shift（替换 v3 原段）

| Token | Light | Dark |
|---|---|---|
| `--primary` | `#C8A0A4` muted rose-mauve | `#D4A8A8` peachy rose |
| `--primary-soft` | `#D8B8BC` | `#DCB8B8` |
| `--primary-glow` | `rgba(212, 168, 168, 0.28)` | `rgba(232, 188, 180, 0.30)` |
| `--primary-light` | `rgba(200, 160, 164, 0.10)` | `rgba(212, 168, 168, 0.12)` |
| `--primary-subtle` | `rgba(200, 160, 164, 0.05)` | `rgba(212, 168, 168, 0.06)` |
| `--primary-hover` | `#B89098` | `#C49AA0` |

**Accent 4 色（保留命名位但换为暖色族）**：

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--accent-amber` → `--accent-butter` | `#F5E5BE` | `#D8B884` | 黄 |
| `--accent-coral` → `--accent-blush` | `#F2D5D2` | `#C49898` | 粉 |
| `--accent-rose` 保持命名 | `#E5B8B0` | `#A87474` | 淡红 / 玫瑰 |
| `--accent-sky` → `--accent-lilac` | `#DCC8DC` | `#9C7CA8` | 淡紫 |
| `--accent-emerald` 保留 | 状态色（成功 / 在线） | 状态色 | 不进 prism |

## 2. Background（替换 v3 原段）

三层 / 四层渐变叠加，整体走 warm pastel：

- `--bg-base`：`#FBF6EE` warm cream（light）/ `#1C1216` deep wine-plum（dark）
- `--bg-radial-1`（左上）：`radial-gradient(... rgba(245, 229, 190, 0.18) ...)` butter 黄 haze
- `--bg-radial-2`（右下）：`radial-gradient(... rgba(220, 200, 220, 0.20) ...)` lilac 紫 haze
- `--bg-radial-3`（居中淡粉点缀）：`rgba(242, 213, 210, 0.10)` blush 粉 haze
- `--bg-mesh-noise`：SVG fractalNoise 0.02 透明（不变）
- `background-attachment: fixed`（不变）

视觉：cream 底色，左上漂淡黄、右下漂淡紫、中间一抹淡粉，整体饱和压在 18–20% 以下，给 Liquid Glass 留够折射内容。

## 3. Glass surface tokens（替换 v3 原段）

- `--glass-liquid-1`：`blur(28px) saturate(1.6)`，底色 `rgba(251, 246, 238, 0.72)`（light）/ `rgba(50, 32, 38, 0.55)`（dark）
- `--glass-liquid-2`：`blur(32px) saturate(1.8)`，`rgba(251, 246, 238, 0.60)` / `rgba(50, 32, 38, 0.48)`
- `--glass-liquid-3`：`blur(40px) saturate(2.0)`，`rgba(251, 246, 238, 0.50)` / `rgba(50, 32, 38, 0.42)`（dialog）

**Edge treatment（伪元素）**：
- `::before` 顶部 specular：`1px solid rgba(255, 248, 235, 0.60)`（light）/ `rgba(255, 220, 200, 0.16)`（dark），暖白高光
- `::after` 底部 chromatic inner shadow：`1px solid rgba(212, 160, 160, 0.16)`（light）/ `rgba(192, 132, 144, 0.20)`（dark），暖玫瑰折射

## 4. Dark mode（替换 v3 原段）

`prefers-color-scheme: dark` 切到 **深酒红 / 暖深紫**渐变 `#1C1216 → #281A22`（不再用深海军），所有 glass 反色 + **warm peach glow** `--glow-warm: rgba(212, 168, 168, 0.24)`（取代原 cool blue glow）。

## 5. Logo Prism（替换 v3 原 "slate teal → sky → amber" 三色）

新版四色 prism 渐变，light / dark 各一套：

- **Light**：`#F5E5BE` butter → `#F2D5D2` blush → `#E5B8B0` rose → `#DCC8DC` lilac
- **Dark**：`#D8B884` → `#C49898` → `#A87474` → `#9C7CA8`

Logo 的 "S" 折角 + prism 折射结构维持 v3 不动，只换 `stop-color`。

## 6. Asset prompts — 颜色行替换

**A. icon-1024.png**
- Scene/backdrop：`warm cream radial gradient base (#FBF6EE to #1C1216) with subtle 0.3% film grain`
- Subject prism 段：`refracting into a prism of four warm pastels (butter #F5E5BE → blush #F2D5D2 → dusty rose #E5B8B0 → lilac #DCC8DC) at the bend`
- Color palette：`warm cream / butter / blush / dusty rose / lilac on deep wine-plum gradient`

**B. og-image.png**
- Color palette：`cream / butter / blush / rose / lilac on warm dark backdrop`
- prism wash 改 `butter + blush + rose + lilac at 6% opacity`

**C. hero.png**
- Color palette：`cream / butter / blush / rose / lilac on warm dark gradient`
- prism wash 改 `soft butter wash top-left (8%) and warm blush wash bottom-right (6%)`

---

## 不变的部分（保持 v3 原状）

- Liquid Glass 三层 blur / saturate 数值、伪元素结构、`.glass-*` 全部类名（`glass-card / glass-dialog / glass-btn / glass-input / glass-header / glass-sidebar / glass-tab / glass-toggle / glass-badge / glass-liquid-floating / glass-liquid-deep / glass-pill`）
- Logo "Ink & Prism" 概念、单笔折角 + prism 折射结构、shimmer 8s 动画
- Icons.tsx 1.5px 重画 + 8 个新图标清单
- 接入位置：index.html / App.tsx / SidebarContent.tsx 三个替换点
- File operations 表（路径与新增 / 修改完全不动）
- Test plan 8 条全部适用，只把视觉描述里的 "teal" 改成 "rose-mauve"、"navy" 改成 "wine-plum"
- Assumptions 全部保留：Inter 字体、不动业务组件、不引新依赖、`prefers-color-scheme` 自动切换、单 round 完成

---

## 实施 Checklist

- [x] 保存 v3.1 patch 到 `frontend/docs/plans/liquid-glass-v3-warm.md`
- [ ] 重写 `frontend/src/styles/liquid-glass.css` 为 v3.1 暖色
- [ ] 新建 `frontend/src/components/ui/Logo.tsx`（LogoMark / Wordmark / Animated）
- [ ] 重写 `frontend/src/components/ui/Icons.tsx`（1.5px + 8 个新图标 + LogoIcon re-export）
- [ ] 更新 `frontend/index.html`（favicon / apple-touch / og / theme-color）
- [ ] 更新 `frontend/src/App.tsx` header 接入 LogoMarkWithWordmark
- [ ] 手写 `frontend/public/favicon.svg`（双模式 stop-color）
- [ ] imagegen 出 icon-1024 / icon-512 / icon-192 / apple-touch-icon / og-image / hero PNG
- [ ] 把 PNG 移入 `frontend/public/` 对应文件名
- [ ] `npm run build` 验证 TypeScript 与编译通过
