"""Draw the Surf AI mark (three original dots) into png, ico, and icns."""
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
    radius = size * 0.22
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=INK)

    def dot(cx, cy, r, color):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)

    s = size
    dot(s * 0.30, s * 0.58, s * 0.13, WHITE)
    dot(s * 0.52, s * 0.42, s * 0.18, ORANGE)
    dot(s * 0.74, s * 0.60, s * 0.10, WHITE)
    eye = INK
    er = max(2, s * 0.018)
    for dx in (-0.045, 0.045):
        cx, cy = s * (0.52 + dx), s * 0.41
        d.ellipse([cx - er, cy - er * 1.3, cx + er, cy + er * 1.3], fill=eye)
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
    print("wrote", OUT / "icon.png")


if __name__ == "__main__":
    main()
