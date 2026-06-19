# StudyKit — imagegen 资产清单 (v3.1 暖色调)

> 这 6 张 PNG 由 v3.1 暖色调补丁驱动。CLI 路径在沙箱里因为 `CODEX_SANDBOX_NETWORK_DISABLED=1` + 无 `OPENAI_API_KEY` 跑不了，请在你本地或解封网络后用 `$CODEX_HOME/skills/.system/imagegen/scripts/image_gen.py` 执行。

环境：

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export IMAGE_GEN="$CODEX_HOME/skills/.system/imagegen/scripts/image_gen.py"
export OPENAI_API_KEY=...  # 在本地 export 你的 key
```

输出目录：

```bash
mkdir -p "$CODEX_HOME/generated_images/studykit-v3-warm"
```

---

## 1. `icon-1024.png` — iOS / PWA 主图标

尺寸：`1024x1024` · 用途：app icon master · 模型：`gpt-image-2`

```bash
python "$IMAGE_GEN" generate \
  --size 1024x1024 \
  --quality high \
  --out "$CODEX_HOME/generated_images/studykit-v3-warm/icon-1024.png" \
  --prompt 'Use case: product-mockup
Asset type: iOS / PWA app icon, 1024x1024
Primary request: a Liquid Glass app icon for "StudyKit", an academic learning workspace
Scene/backdrop: warm cream radial gradient base (#FBF6EE to #1C1216) with subtle 0.3% film grain, no floor, no shadow plane
Subject: a single ink-stroke "S" formed by a folded bookmark / page corner, refracting into a prism of four warm pastels (butter #F5E5BE → blush #F2D5D2 → dusty rose #E5B8B0 → lilac #DCC8DC) at the central bend
Style/medium: Apple visionOS Liquid Glass, premium minimalist, photoreal glass render
Composition/framing: square 1024x1024, iOS-style 22.4% rounded corners (228px radius), subject centered with 12% padding
Lighting/mood: top-down soft specular highlight (warm white 22% opacity, 4px wide at top edge), bottom inner shadow (warm rose 12%), single ambient rim light from upper-left
Materials/textures: ultra-clear frosted glass with 1px warm white inner highlight on top edge, fine chromatic fringe at the prism bend, subtle inner glow
Color palette: warm cream / butter / blush / dusty rose / lilac on deep wine-plum gradient
Constraints: no text, no wordmark, no watermark, no logos besides the mark, no external branding
Avoid: drop shadow on background, external floor reflection, busy background, gradients other than specified'
```

预期：先生成 1 张主选，再用 `image_gen edit` 微调（prism 色温、specular 强度、圆角比例）。

---

## 2. `icon-512.png` — PWA medium

尺寸：`1024x1024` (模型支持最小 1024，再自己 downscale) · 用途：PWA 512×512

```bash
python "$IMAGE_GEN" generate \
  --size 1024x1024 \
  --quality high \
  --out "$CODEX_HOME/generated_images/studykit-v3-warm/icon-512-src.png" \
  --prompt 'Same as icon-1024 prompt, but framed for 512x512 downscale — the mark must stay legible at 16px favicon size. Slightly bolder S-stroke, slightly larger prism highlight (about 1.3x).'
# 然后用 sips 或 imagemagick downscale 到 512x512：
sips -Z 512 "$CODEX_HOME/generated_images/studykit-v3-warm/icon-512-src.png" --out frontend/public/icon-512.png
```

---

## 3. `icon-192.png` — PWA small

同上，但 downscale 到 192：

```bash
python "$IMAGE_GEN" generate \
  --size 1024x1024 \
  --quality high \
  --out "$CODEX_HOME/generated_images/studykit-v3-warm/icon-192-src.png" \
  --prompt 'Same as icon-1024 prompt, framed for 192x192 downscale — extra-bold S-stroke (about 1.4x), extra-prominent prism (about 1.5x), no film grain at all to keep small pixels clean.'
sips -Z 192 "$CODEX_HOME/generated_images/studykit-v3-warm/icon-192-src.png" --out frontend/public/icon-192.png
```

---

## 4. `apple-touch-icon.png` — iOS 180×180

```bash
python "$IMAGE_GEN" generate \
  --size 1024x1024 \
  --quality high \
  --out "$CODEX_HOME/generated_images/studykit-v3-warm/apple-touch-src.png" \
  --prompt 'Same as icon-1024 prompt but framed for iOS apple-touch-icon 180x180 downscale — the iOS mask will round the corners, so design the mark without rounded corners. Full bleed to 1024 canvas.'
sips -Z 180 "$CODEX_HOME/generated_images/studykit-v3-warm/apple-touch-src.png" --out frontend/public/apple-touch-icon.png
```

---

## 5. `og-image.png` — 社交分享卡 (1200×630)

尺寸：`1536x1024` (模型宽屏档) · 用途：Open Graph / Twitter Card

```bash
python "$IMAGE_GEN" generate \
  --size 1536x1024 \
  --quality high \
  --out "$CODEX_HOME/generated_images/studykit-v3-warm/og-image-src.png" \
  --prompt 'Use case: ads-marketing
Asset type: Open Graph social card, 1200x630
Primary request: a Liquid Glass social preview for StudyKit
Scene/backdrop: deep wine-plum gradient with a soft prism wash (butter + blush + rose + lilac at 6% opacity), no floor
Subject: left 38% a glass panel carrying the "S" Logo mark + "StudyKit" wordmark + tagline "The academic learning operating system"; right 62% three floating glass cards showing "Notes" / "Literature" / "AI Revision" labels
Style/medium: Apple visionOS Liquid Glass, premium minimalist
Composition/framing: 1200x630 landscape, soft 24px rounded glass panels, generous negative space
Lighting/mood: upper-left key light, top specular highlight on each glass card (warm white), subtle inner glow at the prism wash
Color palette: cream / butter / blush / rose / lilac on warm dark backdrop
Text (verbatim): wordmark "StudyKit" in Inter SemiBold 64px white at 95% opacity; tagline "The academic learning operating system" in Inter Regular 28px at 70% opacity; card labels "Notes" / "Literature" / "AI Revision" in Inter Medium 24px at 80% opacity
Constraints: no emoji, no watermark, no stock photography
Avoid: decorative gradient orbs, bokeh blobs, busy textures'
# 裁剪到 1200x630（用 sips 的 --cropToHeightWidth，或 imagemagick）：
sips --cropToHeightWidth 630 1200 "$CODEX_HOME/generated_images/studykit-v3-warm/og-image-src.png" --out frontend/public/og-image.png
```

---

## 6. `hero.png` — 营销 hero (1920×1080)

尺寸：`1536x1024` (模型宽屏档) · 用途：landing hero banner

```bash
python "$IMAGE_GEN" generate \
  --size 1536x1024 \
  --quality high \
  --out "$CODEX_HOME/generated_images/studykit-v3-warm/hero-src.png" \
  --prompt 'Use case: product-mockup
Asset type: marketing hero banner, 1920x1080
Primary request: a Liquid Glass hero banner for StudyKit landing page
Scene/backdrop: deep wine-plum radial gradient with soft butter wash top-left (8%) and warm blush wash bottom-right (6%), subtle 0.3% noise texture, no floor
Subject: lower-left 70% of frame a single large frosted-glass panel containing the LogoMark + "StudyKit" + tagline "Lecture slides, notes, literature, and AI revision in one workspace"; upper-right three small floating glass cards each showing a study scene (lecture slides, open paper, flashcards) as soft inner-illustration
Style/medium: Apple visionOS Liquid Glass, premium minimalist
Composition/framing: 1920x1080, hero panel anchored bottom-left, floating cards anchored upper-right with 64px gap, generous negative space top-right for headline overlay
Lighting/mood: upper-left key light, top specular highlight on hero panel (warm white 22% opacity 6px), inner glow on floating cards, soft chromatic fringe at panel edges
Color palette: cream / butter / blush / rose / lilac on warm dark gradient
Text (verbatim): "StudyKit" Inter SemiBold 96px white 95%; tagline Inter Regular 36px at 75%
Constraints: no watermark, no stock photography, no decorative orbs
Avoid: split text-and-card layout, gradient hero, blurred dark stock backgrounds'
# resize 到 1920x1080：
sips -Z 1080 "$CODEX_HOME/generated_images/studykit-v3-warm/hero-src.png" --out frontend/public/hero.png
```

---

## 验证清单

- [ ] `frontend/public/favicon.svg` 已经是手写 SVG（双模式 prism），无需 imagegen。
- [ ] `frontend/public/icon-1024.png` ≥ 100KB
- [ ] `frontend/public/icon-512.png` 缩到 16px favicon 时仍能识别主体
- [ ] `frontend/public/icon-192.png` 缩到 32px 时棱镜色带仍清晰
- [ ] `frontend/public/apple-touch-icon.png` iOS 不再加圆角（系统自动 mask）
- [ ] `frontend/public/og-image.png` 在 Twitter / Facebook / LinkedIn 预览尺寸下文字不被裁切
- [ ] `frontend/public/hero.png` 桌面 / 移动 viewport 下都留有下一区块的提示
