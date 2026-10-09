"""Strip hidden and non-visible HTML before text extraction.

The report is counts only. Removed strings are not logged or returned.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

from .injection import filter_paragraphs, normalize_text

REPORT_KEYS = (
    "hidden_css",
    "hidden_attr",
    "color_match",
    "comments",
    "noscript",
    "template",
    "nonvisible_text",
    "unicode_controls",
    "script_style",
)

_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
_SKIP = {"script", "style", "noscript", "template", "svg", "iframe"}
_BLOCK = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "article", "section", "br", "tr", "blockquote", "pre"}
_INHERIT = ("color", "visibility", "font-size")
_NAMED = {
    "white": (255, 255, 255), "black": (0, 0, 0), "red": (255, 0, 0), "green": (0, 128, 0),
    "blue": (0, 0, 255), "yellow": (255, 255, 0), "transparent": None,
}


class _Node:
    def __init__(self, tag: str, attrs: dict[str, str] | None = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list = []


class _Text:
    def __init__(self, data: str):
        self.data = data


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node("document")
        self.stack = [self.root]
        self.report = {key: 0 for key in REPORT_KEYS}

    def handle_starttag(self, tag, attrs):
        node = _Node(tag.lower(), {key.lower(): value for key, value in attrs})
        self.stack[-1].children.append(node)
        if tag.lower() not in _VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        if data:
            self.stack[-1].children.append(_Text(data))

    def handle_comment(self, data):
        self.report["comments"] += 1


def _parse_inline(style: str | None) -> dict[str, str]:
    props: dict[str, str] = {}
    if not style:
        return props
    for part in style.split(";"):
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        props[key.strip().lower()] = value.strip().lower()
    return props


def _css_rules(css: str) -> list[tuple[str, dict[str, str]]]:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    rules = []
    for block in re.finditer(r"([^{}]+)\{([^{}]+)\}", css):
        props: dict[str, str] = {}
        for part in re.split(r"[;\n]+", block.group(2)):
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            props[key.strip().lower()] = value.strip().lower()
        for selector in block.group(1).split(","):
            selector = " ".join(selector.split())
            if selector:
                rules.append((selector, props))
    return rules


def _specificity_simple(selector: str, tag: str, classes: set[str], ident: str) -> int | None:
    raw = selector.strip().lower()
    if not raw or any(token in raw for token in (" ", ">", "+", "~", "[", ":")):
        return None
    spec = 0
    wanted_id = ""
    class_names: list[str] = []
    if "#" in raw:
        before, after = raw.split("#", 1)
        wanted_id = after.split(".")[0]
        class_names.extend(part for part in after.split(".")[1:] if part)
        raw = before
    if wanted_id and wanted_id != ident:
        return None
    if wanted_id:
        spec += 100
    element = ""
    if raw.startswith("."):
        class_names = [part for part in raw.split(".") if part] + class_names
    elif raw:
        bits = [part for part in raw.split(".") if part]
        element = bits[0]
        class_names = bits[1:] + class_names
    if element and element != tag:
        return None
    if element:
        spec += 1
    for name in class_names:
        if name not in classes:
            return None
        spec += 10
    if spec == 0:
        return None
    return spec


def _apply_rules(tag: str, attrs: dict[str, str], rules: list[tuple[str, dict[str, str]]]) -> dict[str, str]:
    classes = {part.lower() for part in (attrs.get("class") or "").split() if part}
    ident = (attrs.get("id") or "").lower()
    props: dict[str, str] = {}
    rank: dict[str, int] = {}
    for selector, decl in rules:
        spec = _specificity_simple(selector, tag, classes, ident)
        if spec is None:
            continue
        for key, value in decl.items():
            if spec >= rank.get(key, -1):
                props[key] = value
                rank[key] = spec
    for key, value in _parse_inline(attrs.get("style")).items():
        props[key] = value
    return props


def _inherit(parent: dict[str, str], own: dict[str, str]) -> dict[str, str]:
    style = {key: parent[key] for key in _INHERIT if key in parent}
    style.update(own)
    try:
        parent_opacity = float(parent.get("opacity", "1"))
        own_opacity = float(own.get("opacity", "1"))
    except ValueError:
        parent_opacity, own_opacity = 1.0, 1.0
    if "opacity" in parent or "opacity" in own:
        style["opacity"] = str(parent_opacity * own_opacity)
    return style


def _parse_color(value: str | None):
    if not value:
        return None
    value = value.strip().lower().split("!")[0].strip()
    if value in _NAMED:
        return _NAMED[value]
    match = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", value)
    if match:
        hex_value = match.group(1)
        if len(hex_value) == 3:
            hex_value = "".join(ch * 2 for ch in hex_value)
        return tuple(int(hex_value[i:i + 2], 16) for i in (0, 2, 4))
    match = re.fullmatch(r"rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+)?\s*\)", value)
    if match:
        return tuple(max(0, min(255, int(float(match.group(i))))) for i in (1, 2, 3))
    return None


def _nearly(left, right) -> bool:
    if not left or not right:
        return False
    distance = sum((left[i] - right[i]) ** 2 for i in range(3)) ** 0.5
    return distance <= 40


def _length_zero(value: str | None) -> bool:
    if not value:
        return False
    return bool(re.match(r"^0(?:\.0+)?(?:px|pt|em|rem|%)?$", value.strip().lower()))


def _tiny_font(value: str | None) -> bool:
    if not value:
        return False
    value = value.strip().lower()
    match = re.match(r"^([0-9.]+)(px|pt|em|rem|%)?$", value)
    if not match:
        return False
    number = float(match.group(1))
    unit = match.group(2) or "px"
    if unit in {"px", "pt"} and number <= 1:
        return True
    if unit in {"em", "rem"} and number <= 0.05:
        return True
    return False


def _far(value: str | None) -> bool:
    if not value:
        return False
    match = re.match(r"^(-?[0-9.]+)(px|pt)?$", value.strip().lower())
    if not match:
        return False
    number = float(match.group(1))
    return number <= -50 or abs(number) >= 1000


def _hidden_css(style: dict[str, str]) -> bool:
    if style.get("display") == "none":
        return True
    if style.get("visibility") in {"hidden", "collapse"}:
        return True
    try:
        if float(style.get("opacity", "1")) <= 0.01:
            return True
    except ValueError:
        pass
    if _tiny_font(style.get("font-size")):
        return True
    if _length_zero(style.get("width")) and _length_zero(style.get("height")):
        return True
    if _length_zero(style.get("height") or style.get("max-height")) and style.get("overflow") == "hidden":
        return True
    position = style.get("position", "")
    if position in {"absolute", "fixed"} and any(_far(style.get(key)) for key in ("left", "top", "right", "bottom", "text-indent")):
        return True
    if _far(style.get("text-indent")):
        return True
    clip = style.get("clip", "")
    if "rect" in clip and re.search(r"rect\(\s*0", clip):
        return True
    clip_path = style.get("clip-path", "")
    if "inset(100%" in clip_path or "inset(50%" in clip_path:
        return True
    return False


def _css_text(node: _Node) -> str:
    if node.tag in {"style"}:
        return "".join(child.data for child in node.children if isinstance(child, _Text))
    return "".join(_css_text(child) for child in node.children if isinstance(child, _Node))


def _find_title(node: _Node) -> str | None:
    if node.tag == "title":
        text = "".join(child.data for child in node.children if isinstance(child, _Text)).strip()
        return text or None
    for child in node.children:
        if isinstance(child, _Node):
            found = _find_title(child)
            if found:
                return found
    return None


def _published(node: _Node) -> str | None:
    if node.tag == "meta":
        prop = (node.attrs.get("property") or node.attrs.get("name") or "").lower()
        if prop in {"article:published_time", "pubdate", "date", "dc.date"}:
            return node.attrs.get("content") or None
    for child in node.children:
        if isinstance(child, _Node):
            found = _published(child)
            if found:
                return found
    return None


def _walk(node, style: dict[str, str], background, rules, report: dict[str, int], out: list[str]) -> None:
    for child in node.children:
        if isinstance(child, _Text):
            if child.data.strip():
                out.append(child.data)
            continue
        if not isinstance(child, _Node):
            continue
        tag = child.tag
        if tag in {"script", "style"}:
            if any(isinstance(item, _Text) and item.data.strip() for item in child.children):
                report["script_style"] += 1
            continue
        if tag == "noscript":
            report["noscript"] += 1
            continue
        if tag == "template":
            report["template"] += 1
            continue
        if tag in {"meta", "title", "link", "head"}:
            if tag == "meta" and child.attrs.get("content"):
                report["nonvisible_text"] += 1
            if tag == "title":
                report["nonvisible_text"] += 1
            if tag == "head":
                _walk(child, style, background, rules, report, [])
            continue
        for key in ("alt", "aria-label", "title"):
            if child.attrs.get(key):
                report["nonvisible_text"] += 1
        if "hidden" in child.attrs or child.attrs.get("aria-hidden", "").lower() == "true":
            report["hidden_attr"] += 1
            continue
        own = _apply_rules(tag, child.attrs, rules)
        merged = _inherit(style, own)
        if _hidden_css(merged):
            report["hidden_css"] += 1
            continue
        next_bg = background
        painted = _parse_color(own.get("background-color") or own.get("background"))
        if painted:
            next_bg = painted
        color = _parse_color(merged.get("color"))
        if color and next_bg and _nearly(color, next_bg):
            report["color_match"] += 1
            continue
        if tag in _BLOCK:
            out.append("\n")
        _walk(child, merged, next_bg, rules, report, out)
        if tag in _BLOCK:
            out.append("\n")


def visible_text(raw: str) -> tuple[str, str | None, str | None, dict[str, int]]:
    builder = _Builder()
    try:
        builder.feed(raw)
        builder.close()
    except Exception:
        text, removed = normalize_text(re.sub(r"(?s)<[^>]+>", " ", raw))
        report = {key: 0 for key in REPORT_KEYS}
        report["unicode_controls"] = removed
        return text, None, None, report
    rules = _css_rules(_css_text(builder.root))
    pieces: list[str] = []
    _walk(builder.root, {}, (255, 255, 255), rules, builder.report, pieces)
    text = re.sub(r"[ \t]+\n", "\n", "".join(pieces))
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    text, removed = normalize_text(text)
    builder.report["unicode_controls"] += removed
    title = _find_title(builder.root)
    if title:
        title, removed_title = normalize_text(title)
        builder.report["unicode_controls"] += removed_title
        title = title.strip() or None
    return text, title, _published(builder.root), builder.report


def prepare_page(raw: str, url: str = "") -> dict:
    """Sanitize, then keep only paragraphs that are not high-scoring instructions."""
    del url  # the caller logs the host; the body is not logged
    text, title, published, report = visible_text(raw)
    kept, injection, ignored = filter_paragraphs(text)
    if title:
        judged = filter_paragraphs(title)[1]
        if judged["action"] == "drop":
            title = None
    return {
        "text": kept[:8000],
        "title": (title or None),
        "published": published,
        "sanitizer": report,
        "injection": injection,
        "ignored": ignored,
    }
