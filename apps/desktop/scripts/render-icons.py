"""Draw the Surf AI jellyfish mark into png, ico, and icns."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build"
WEB = ROOT.parents[1] / "apps" / "web" / "public"

INK = (20, 20, 20, 255)
ORANGE = (249, 115, 22, 255)
WHITE = (255, 255, 255, 255)


def draw(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = size * 0.06
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=size * 0.22, fill=INK)
    cx, cy = size * 0.50, size * 0.40
    rx, ry = size * 0.22, size * 0.16
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=ORANGE, outline=WHITE, width=max(2, int(size * 0.012)))
    er = max(2, size * 0.018)
    for dx in (-0.06, 0.06):
        ex, ey = size * (0.50 + dx), size * 0.40
        d.ellipse([ex - er, ey - er * 1.15, ex + er, ey + er * 1.15], fill=INK)
    # Four tentacles. White so they read on the black tile.
    w = max(2, int(size * 0.018))
    def tent(x0, y0, x1, y1, x2, y2):
        # Quadratic via short line segments.
        pts = []
        for i in range(13):
            t = i / 12
            u = 1 - t
            pts.append((u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2))
        d.line(pts, fill=WHITE, width=w, joint="curve")
    s = size
    y = s * 0.54
    tent(s * 0.36, y, s * 0.28, s * 0.70, s * 0.40, s * 0.82)
    tent(s * 0.46, y + s * 0.02, s * 0.44, s * 0.74, s * 0.48, s * 0.86)
    tent(s * 0.56, y + s * 0.02, s * 0.60, s * 0.74, s * 0.54, s * 0.86)
    tent(s * 0.66, y, s * 0.76, s * 0.68, s * 0.62, s * 0.80)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = draw(1024)
    base.save(OUT / "icon.png")
    sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    images = [base.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]
    images[2].save(OUT / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    try:
        base.save(OUT / "icon.icns", format="ICNS", append_images=images)
    except Exception as exc:  # noqa: BLE001
        print("icns skipped:", exc)
    mark = draw(512)
    WEB.mkdir(parents=True, exist_ok=True)
    mark.save(WEB / "favicon.png")
    mark.resize((180, 180), Image.Resampling.LANCZOS).save(WEB / "apple-touch-icon.png")
    base.save(ROOT / "resources" / "icon.png")
    print("wrote", OUT / "icon.png")


if __name__ == "__main__":
    main()
