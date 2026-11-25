# StudyKit v0.4 WP-11R1 产品收敛报告

日期：2026-07-31  
状态：**Engineering Gate PASS；已覆盖安装并完成真实桌面验收**

## 1. 本轮目标

修复 WP-11R0 发现的 P0 组合问题：v0.4 Router 与完整 v0.3 应用同时渲染，造成双侧栏、双导航源、Study/Research 串页和重复空状态。本轮不扩张功能面，只收敛产品骨架。

## 2. 已完成

- 生产环境每次只渲染一个 v0.4 active surface；完整 legacy body 不再常驻。
- 新增由 `AppLocation` 驱动的 mode-aware sidebar：Study 与 Research 菜单严格隔离；Research 项目内提供 Overview / Discover / Library / Evidence / Design / Canvas。
- `ModeSwitch` 不再写入 legacy `sidebarMode`，生产导航只有一个事实来源。
- legacy 只保留为 `study/lecture` 的窄兼容叶；进入 Lecture 前显式同步 course/lecture selection，避免入口打开空白。
- URL hash 完整保存 `surfaceId` 与参数，刷新、前进/后退不丢 Discovery、Question 等上下文。
- Study 的首个课程创建入口迁入当前侧栏；Quick Capture 输入适配 Light/Dark 主题。
- 更新生产组合测试，覆盖无 legacy 重复 body、单一侧栏、模式隔离、真实课程创建与重载持久化。

## 3. 验证证据

- TypeScript：0 errors。
- Vitest：1193 passed / 2 skipped / 0 failed（391 suites）。
- Rust：73 passed / 0 failed。
- Web production build：通过。
- macOS `.app` bundle：通过；ad-hoc deep codesign 校验通过。
- `git diff --check`：通过。
- 已覆盖安装 `/Applications/StudyKit.app`，完全退出后重新启动新版本。

真实桌面检查结果：

- Study Home：仅一个 Study sidebar 和一个 Study surface；旧 Modules / Library / Canvas 侧栏及重复 Welcome 空状态已消失。
- Research Home：仅显示研究项目入口和项目列表；未混入旧 Literature Library。
- Research Project / Library：项目级导航自然展开；Library 只渲染一份，未出现重复 legacy 页面。
- Light 与 Dark 均可读、可切换；检查后恢复 Dark。

截图：

- `frontend/docs/wp11r1-product-convergence/01-study-home-converged.png`
- `frontend/docs/wp11r1-product-convergence/02-research-home-converged.png`
- `frontend/docs/wp11r1-product-convergence/03-research-library-converged.png`
- `frontend/docs/wp11r1-product-convergence/04-research-library-light.png`

## 4. 仍保留的边界

- Study Lecture Focus 仍复用 v0.3 内容叶；已隔离状态桥，但应在后续 Study 收敛包中替换为完整 v0.4 surface。
- Library、Evidence、Design、Canvas 内部的视觉密度和空状态仍不统一；本轮只修骨架与导航，不把视觉重做混入 P0 修复。
- 构建仍有既有大 chunk 警告；Canvas 测试仍输出既有 React `act` / SVG NaN 警告，但测试无失败。本轮未用 suppress/filter 隐藏。
- 未执行 commit / push / stage / stash / reset / checkout。

## 5. 下一步

进入 **WP-11R2 Study Mode 收敛**：用 v0.4 Lecture Workspace 替换最后的 legacy leaf，统一 Course → Lecture → Capture/Understand → Review 的页面层级、空状态和自然 AI 入口；完成后再进入 WP-11R3 Research 内部表面收敛。
