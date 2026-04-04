"""
Regenerate assets/banner.png and assets/social-preview.png.

The banner is 1600x400 pixels, used at the top of the main README. The social
preview is 1280x640 pixels, uploaded through the GitHub UI as the repository
social preview image.

Brand: ghos.xyz magenta (#ff1249) on black (#0a0a0a), monospace wordmark, no
emoji.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
BG = (10, 10, 10)
MAGENTA = (255, 18, 73)
WHITE = (240, 240, 240)
MID_GREY = (170, 170, 170)
DIM_GREY = (110, 110, 110)


def pick_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/consolab.ttf",
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_ghost(d: ImageDraw.ImageDraw, x: int, y: int, width: int, height: int) -> None:
    d.rounded_rectangle([x, y + 60, x + width, y + height + 30], radius=width // 2, fill=WHITE)
    d.pieslice([x, y, x + width, y + height - 60], start=180, end=360, fill=WHITE)
    step = width // 6
    for i in range(6):
        cx = x + step // 2 + i * step
        cy = y + height + 20
        d.pieslice([cx - step // 2, cy - step // 2, cx + step // 2, cy + step // 2],
                   start=0, end=180, fill=BG)
    d.ellipse([x + 50, y + 110, x + 80, y + 160], fill=MAGENTA)
    d.ellipse([x + 140, y + 110, x + 170, y + 160], fill=MAGENTA)


def render_banner() -> Path:
    W, H = 1600, 400
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f_big = pick_font(180)
    f_mid = pick_font(38)
    f_sml = pick_font(24)
    d.text((120, 90), "ghos", font=f_big, fill=WHITE)
    d.text((500, 90), ".xyz", font=f_big, fill=MAGENTA)
    d.text((124, 290),
           "Solana privacy OS, Token-2022 Confidential Balances",
           font=f_mid, fill=MID_GREY)
    d.text((124, 340),
           "on-device ZK proofs, burner accounts, optional auditor",
           font=f_sml, fill=DIM_GREY)
    draw_ghost(d, 1260, 90, 220, 260)
    d.rectangle([0, H - 6, W, H], fill=MAGENTA)
    out = ASSETS / "banner.png"
    ASSETS.mkdir(exist_ok=True)
    img.save(out, optimize=True)
    return out


def render_social_preview() -> Path:
    W, H = 1280, 640
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f_big = pick_font(210)
    f_mid = pick_font(44)
    f_sml = pick_font(28)
    d.text((180, 200), "ghos", font=f_big, fill=WHITE)
    d.text((530, 200), ".xyz", font=f_big, fill=MAGENTA)
    d.text((184, 430), "Solana privacy OS", font=f_mid, fill=(200, 200, 200))
    d.text((184, 490), "Token-2022 Confidential Balances",
           font=f_sml, fill=(140, 140, 140))
    d.text((184, 530), "github.com/ghosxyz/ghos",
           font=f_sml, fill=(140, 140, 140))
    d.rectangle([0, H - 10, W, H], fill=MAGENTA)
    out = ASSETS / "social-preview.png"
    img.save(out, optimize=True)
    return out


def main() -> None:
    banner = render_banner()
    preview = render_social_preview()
    print(f"wrote {banner} ({banner.stat().st_size} bytes)")
    print(f"wrote {preview} ({preview.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
