# -*- coding: utf-8 -*-
"""
Regenerate public/share-cover.png (1200x630) with the new bilingual brand:
Chinese 「与链」 + English 「ulink」.

Design (keeps the previous LinkVault cover's visual language):
- Deep blue #122E8A gradient background
- Chain-link icon (drawn with PIL lines/arcs)
- Big 「与链」 (DengXian bold), small "ulink" next to it
- Subtitle: 个人书签管理器 · Personal Bookmark Manager
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 630
BG_TOP = (18, 46, 138)     # #122E8A
BG_BOTTOM = (30, 64, 175)  # slightly lighter for a subtle vertical gradient

img = Image.new("RGB", (W, H), BG_TOP)
d = ImageDraw.Draw(img)

# vertical gradient
for y in range(H):
    t = y / (H - 1)
    c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
    d.line([(0, y), (W, y)], fill=c)

FONT_DIR = "C:/Windows/Fonts"

def font(path, size):
    return ImageFont.truetype(f"{FONT_DIR}/{path}", size)

f_brand_zh = font("Dengb.ttf", 150)   # 与链
f_brand_en = font("Deng.ttf", 64)     # ulink
f_sub = font("Deng.ttf", 34)          # subtitle
f_fallback = font("Deng.ttf", 34)

# ── chain-link icon (drawn top-center) ──
def draw_chain(dr, cx, cy, scale=1.0, color=(255, 255, 255)):
    """Two interlocking chain links, stroke style, centered at (cx, cy)."""
    w = 8 * scale
    r = 26 * scale
    gap = 14 * scale
    # link 1 (left)
    x1 = cx - gap / 2 - r
    y1 = cy - r
    dr.rounded_rectangle([x1 - w / 2, y1 - w / 2, x1 + r + w / 2, y1 + 2 * r + w / 2], radius=w, outline=color, width=int(w))
    # link 2 (right) - tilted
    x2 = cx + gap / 2 + r
    dr.rounded_rectangle([x2 - r - w / 2, y1 - w / 2, x2 + w / 2, y1 + 2 * r + w / 2], radius=w, outline=color, width=int(w))

draw_chain(d, W / 2, 120, scale=1.15)

# ── brand text ──
# measure 与链
bb_zh = d.textbbox((0, 0), "与链", font=f_brand_zh)
zh_w = bb_zh[2] - bb_zh[0]
zh_h = bb_zh[3] - bb_zh[1]

bb_en = d.textbbox((0, 0), "ulink", font=f_brand_en)
en_w = bb_en[2] - bb_en[0]
en_h = bb_en[3] - bb_en[1]

gap_between = 26
block_w = zh_w + gap_between + en_w
start_x = (W - block_w) / 2
baseline_y = 300

d.text((start_x - bb_zh[0], baseline_y - bb_zh[1] + (zh_h - en_h) / 2), "与链", font=f_brand_zh, fill=(255, 255, 255))
d.text((start_x + zh_w + gap_between - bb_en[0], baseline_y - bb_en[1]), "ulink", font=f_brand_en, fill=(255, 255, 255))

# ── subtitle ──
sub = "个人书签管理器 · Personal Bookmark Manager"
bb_s = d.textbbox((0, 0), sub, font=f_sub)
sub_w = bb_s[2] - bb_s[0]
d.text(((W - sub_w) / 2 - bb_s[0], 470 - bb_s[1]), sub, font=f_sub, fill=(210, 220, 255))

# ── domain hint ──
dom = "ulink.ren"
bb_d = d.textbbox((0, 0), dom, font=f_sub)
dom_w = bb_d[2] - bb_d[0]
d.text(((W - dom_w) / 2 - bb_d[0], 530 - bb_d[1]), dom, font=f_fallback, fill=(160, 180, 240))

img.save("D:/dev/lv/public/share-cover.png", "PNG")
print("saved share-cover.png", img.size)
