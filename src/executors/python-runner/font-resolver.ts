/**
 * Python source (module level) of the runner's font-file resolver: a TTFont / ImageFont
 * path that is not installed maps to the closest installed font instead of crashing.
 * Kept inside a JS template literal: backslashes are doubled as in the rest of the runner.
 */
export const PY_FONT_RESOLVER = `
_FONT_STYLE_SUFFIXES = (
    ("bolditalic", 3), ("boldoblique", 3), ("bold-italic", 3), ("bold-oblique", 3),
    ("italic", 2), ("oblique", 2), ("it", 2),
    ("bold", 1), ("bd", 1),
    ("regular", 0), ("book", 0), ("roman", 0),
)

def _make_font_file_resolver(search_dirs, serif_files, sans_files, mono_files):
    """Maps a missing font file path to the closest installed one (same file elsewhere,
    another style of the same family, then a generic serif/sans/mono family)."""
    index = {}
    def _build_index():
        if index:
            return index
        for root_dir in search_dirs:
            if not root_dir or not os.path.isdir(root_dir):
                continue
            for dirpath, _dirs, files in os.walk(root_dir):
                for fn in files:
                    if fn.lower().endswith((".ttf", ".ttc")):
                        index.setdefault(fn.lower(), os.path.join(dirpath, fn))
        return index

    def _split_style(stem):
        low = stem.lower()
        for suffix, style in _FONT_STYLE_SUFFIXES:
            for sep in ("-", "_", " ", ""):
                if not sep and len(suffix) <= 2:
                    continue
                tail = sep + suffix
                if low.endswith(tail) and len(low) > len(tail) + 1:
                    return stem[: len(stem) - len(tail)], style
        return stem, 0

    warned = set()
    def resolve(raw_path):
        path_str = os.fsdecode(raw_path)
        base = os.path.basename(path_str)
        idx = _build_index()
        found = idx.get(base.lower())
        stem, style = _split_style(os.path.splitext(base)[0])
        if not found:
            family = stem.lower()
            wanted = {
                0: ("", "-regular", "regular", "-book", "-roman"),
                1: ("-bold", "bold", "-bd", "bd"),
                2: ("-italic", "-oblique", "italic", "oblique", "-it", "i"),
                3: ("-bolditalic", "-boldoblique", "bolditalic", "boldoblique", "bi", "z"),
            }
            # Same family, same style first; then the family's regular face
            for style_try in (style, 0):
                for suffix in wanted[style_try]:
                    for ext in (".ttf", ".ttc"):
                        hit = idx.get(family + suffix + ext)
                        if hit:
                            found = hit
                            break
                    if found:
                        break
                if found:
                    break
        if not found:
            key = stem.lower()
            if any(k in key for k in ("mono", "courier", "consola", "code")):
                generic = mono_files
            elif any(k in key for k in ("serif", "times", "georgia", "garamond", "cambria", "caladea")) and "sans" not in key:
                generic = serif_files
            else:
                generic = sans_files
            if generic:
                found = generic[style] if (style < len(generic) and generic[style] and os.path.exists(generic[style])) else generic[0]
        if not found:
            return raw_path
        if path_str not in warned:
            warned.add(path_str)
            sys.stderr.write(
                "[devnuby] font file not found: " + path_str + " -> using " + found + "\\n"
            )
        return found
    return resolve
`;
