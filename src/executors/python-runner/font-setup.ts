/**
 * Python source (inside `_init_devnuby_sandbox`) that registers fonts for ReportLab:
 * cached Google Fonts, genuine Microsoft core fonts, metric-compatible stand-ins, the
 * missing-font-file preflight, and graceful fallbacks for unknown font names.
 * Kept inside a JS template literal: backslashes are doubled as in the rest of the runner.
 */
export const PY_FONT_SETUP = `
    # Pre-register system fonts ("Times New Roman", "Arial", etc.) & cached Google Fonts in reportlab
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.lib import fonts as rl_fonts
        from reportlab.platypus import paraparser as rl_paraparser

        def _reg_family(fam_name, reg_p, bold_p=None, it_p=None, bi_p=None):
            if not reg_p or not os.path.exists(reg_p):
                return False
            b_p = bold_p if (bold_p and os.path.exists(bold_p)) else reg_p
            i_p = it_p if (it_p and os.path.exists(it_p)) else reg_p
            bi_p_final = bi_p if (bi_p and os.path.exists(bi_p)) else (b_p if b_p != reg_p else i_p)
            pdfmetrics.registerFont(TTFont(fam_name, reg_p))
            pdfmetrics.registerFont(TTFont(f"{fam_name}-Regular", reg_p))
            pdfmetrics.registerFont(TTFont(f"{fam_name}-Bold", b_p))
            pdfmetrics.registerFont(TTFont(f"{fam_name}-Italic", i_p))
            pdfmetrics.registerFont(TTFont(f"{fam_name}-BoldItalic", bi_p_final))
            pdfmetrics.registerFontFamily(
                fam_name,
                normal=fam_name,
                bold=f"{fam_name}-Bold",
                italic=f"{fam_name}-Italic",
                boldItalic=f"{fam_name}-BoldItalic",
            )
            return True

        # 1. Register cached Google Fonts from .devnuby/fonts/
        for gf in cfg.get("cachedFonts", []):
            fam = gf.get("family")
            if fam:
                _reg_family(
                    fam,
                    gf.get("regular"),
                    gf.get("bold"),
                    gf.get("italic"),
                    gf.get("boldItalic"),
                )
                no_space = fam.replace(" ", "")
                if no_space != fam:
                    _reg_family(
                        no_space,
                        gf.get("regular"),
                        gf.get("bold"),
                        gf.get("italic"),
                        gf.get("boldItalic"),
                    )

        # 2. Register cross-platform system font families (Windows + Linux parity)
        def _first_existing(candidates):
            for c_reg, c_bold, c_it, c_bi in candidates:
                if c_reg and os.path.exists(c_reg):
                    return (c_reg, c_bold, c_it, c_bi)
            return None

        # 2a. Genuine Microsoft core fonts (ttf-mscorefonts-installer on Linux, Fonts dir on
        # Windows) under their own names, before the metric-compatible stand-ins below
        ms_dir = "/usr/share/fonts/truetype/msttcorefonts"
        ms_win = os.path.join(win_dir, "Fonts")
        ms_families = {
            "Arial": ("arial", "arialbd", "ariali", "arialbi"),
            "Times New Roman": ("times", "timesbd", "timesi", "timesbi"),
            "Courier New": ("cour", "courbd", "couri", "courbi"),
            "Georgia": ("georgia", "georgiab", "georgiai", "georgiaz"),
            "Verdana": ("verdana", "verdanab", "verdanai", "verdanaz"),
            "Trebuchet MS": ("trebuc", "trebucbd", "trebucit", "trebucbi"),
            "Comic Sans MS": ("comic", "comicbd", None, None),
            "Arial Black": ("ariblk", None, None, None),
            "Impact": ("impact", None, None, None),
            "Andale Mono": ("andalemo", None, None, None),
        }
        for ms_name, stems in ms_families.items():
            for base_dir in (ms_dir, ms_win):
                files = [os.path.join(base_dir, s + ".ttf") if s else None for s in stems]
                if files[0] and os.path.exists(files[0]):
                    _reg_family(ms_name, *files)
                    no_space = ms_name.replace(" ", "")
                    if no_space != ms_name:
                        _reg_family(no_space, *files)
                    break

        # Open stand-ins under their own names too (asked for by name, they must not become Arial)
        lin = "/usr/share/fonts/truetype"
        for own_name, own_files in (
            ("Liberation Serif", ("liberation/LiberationSerif-Regular", "liberation/LiberationSerif-Bold", "liberation/LiberationSerif-Italic", "liberation/LiberationSerif-BoldItalic")),
            ("Liberation Sans", ("liberation/LiberationSans-Regular", "liberation/LiberationSans-Bold", "liberation/LiberationSans-Italic", "liberation/LiberationSans-BoldItalic")),
            ("Liberation Mono", ("liberation/LiberationMono-Regular", "liberation/LiberationMono-Bold", "liberation/LiberationMono-Italic", "liberation/LiberationMono-BoldItalic")),
            ("Caladea", ("crosextra/Caladea-Regular", "crosextra/Caladea-Bold", "crosextra/Caladea-Italic", "crosextra/Caladea-BoldItalic")),
            ("Lato", ("lato/Lato-Regular", "lato/Lato-Bold", "lato/Lato-Italic", "lato/Lato-BoldItalic")),
            ("DejaVu Serif", ("dejavu/DejaVuSerif", "dejavu/DejaVuSerif-Bold", "dejavu/DejaVuSerif-Italic", "dejavu/DejaVuSerif-BoldItalic")),
            ("DejaVu Sans", ("dejavu/DejaVuSans", "dejavu/DejaVuSans-Bold", "dejavu/DejaVuSans-Oblique", "dejavu/DejaVuSans-BoldOblique")),
            ("DejaVu Sans Mono", ("dejavu/DejaVuSansMono", "dejavu/DejaVuSansMono-Bold", "dejavu/DejaVuSansMono-Oblique", "dejavu/DejaVuSansMono-BoldOblique")),
        ):
            own_paths = [lin + "/" + rel + ".ttf" for rel in own_files]
            if own_name not in pdfmetrics._fonts and os.path.exists(own_paths[0]):
                _reg_family(own_name, *own_paths)

        serif_candidates = [
            (
                ms_dir + "/times.ttf",
                ms_dir + "/timesbd.ttf",
                ms_dir + "/timesi.ttf",
                ms_dir + "/timesbi.ttf",
            ),
            (
                os.path.join(win_dir, "Fonts", "times.ttf"),
                os.path.join(win_dir, "Fonts", "timesbd.ttf"),
                os.path.join(win_dir, "Fonts", "timesi.ttf"),
                os.path.join(win_dir, "Fonts", "timesbi.ttf"),
            ),
            (
                "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf",
                "/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf",
                "/usr/share/fonts/truetype/crosextra/Caladea-Italic.ttf",
                "/usr/share/fonts/truetype/crosextra/Caladea-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf",
            ),
        ]
        serif_files = _first_existing(serif_candidates)
        if serif_files:
            for alias in ("Times New Roman", "TimesNewRoman", "Times", "Georgia", "Cambria", "Liberation Serif", "Caladea", "DejaVu Serif"):
                if alias not in pdfmetrics._fonts:
                    _reg_family(alias, *serif_files)

        sans_candidates = [
            (
                ms_dir + "/arial.ttf",
                ms_dir + "/arialbd.ttf",
                ms_dir + "/ariali.ttf",
                ms_dir + "/arialbi.ttf",
            ),
            (
                os.path.join(win_dir, "Fonts", "arial.ttf"),
                os.path.join(win_dir, "Fonts", "arialbd.ttf"),
                os.path.join(win_dir, "Fonts", "ariali.ttf"),
                os.path.join(win_dir, "Fonts", "arialbi.ttf"),
            ),
            (
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-Italic.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/lato/Lato-Regular.ttf",
                "/usr/share/fonts/truetype/lato/Lato-Bold.ttf",
                "/usr/share/fonts/truetype/lato/Lato-Italic.ttf",
                "/usr/share/fonts/truetype/lato/Lato-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
            ),
        ]
        sans_files = _first_existing(sans_candidates)
        if sans_files:
            # Calibri gets its own metric-compatible Carlito below (a font name is registered once)
            for alias in ("Arial", "Verdana", "Tahoma", "Segoe UI", "Liberation Sans", "Lato", "DejaVu Sans"):
                if alias not in pdfmetrics._fonts:
                    _reg_family(alias, *sans_files)

        calibri_candidates = [
            (
                os.path.join(win_dir, "Fonts", "calibri.ttf"),
                os.path.join(win_dir, "Fonts", "calibrib.ttf"),
                os.path.join(win_dir, "Fonts", "calibrii.ttf"),
                os.path.join(win_dir, "Fonts", "calibriz.ttf"),
            ),
            (
                "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-Italic.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-BoldItalic.ttf",
            ),
        ]
        calibri_files = _first_existing(calibri_candidates)
        for alias in ("Calibri", "Carlito"):
            if calibri_files:
                _reg_family(alias, *calibri_files)
            elif sans_files:
                _reg_family(alias, *sans_files)

        mono_candidates = [
            (
                ms_dir + "/cour.ttf",
                ms_dir + "/courbd.ttf",
                ms_dir + "/couri.ttf",
                ms_dir + "/courbi.ttf",
            ),
            (
                os.path.join(win_dir, "Fonts", "cour.ttf"),
                os.path.join(win_dir, "Fonts", "courbd.ttf"),
                os.path.join(win_dir, "Fonts", "couri.ttf"),
                os.path.join(win_dir, "Fonts", "courbi.ttf"),
            ),
            (
                "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationMono-Italic.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationMono-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-BoldOblique.ttf",
            ),
        ]
        mono_files = _first_existing(mono_candidates)
        if mono_files:
            for alias in ("Courier New", "Consolas", "Liberation Mono", "DejaVu Sans Mono"):
                if alias not in pdfmetrics._fonts:
                    _reg_family(alias, *mono_files)

        # 2b. Font FILE preflight: a TTFont / PIL ImageFont pointing at a font file that is
        # not installed here (e.g. DejaVuSans-Oblique.ttf on a host with only fonts-dejavu-core)
        # resolves to the closest installed file instead of crashing the whole document build.
        _resolve_font_file = _make_font_file_resolver(
            [custom_fonts_dir, linux_fonts_dir, linux_local_fonts_dir, fonts_dir],
            serif_files, sans_files, mono_files,
        )
        globals()["_devnuby_font_resolver"] = _resolve_font_file
        _orig_ttfont_init = TTFont.__init__
        def _safe_ttfont_init(self, name, filename, *args, **kwargs):
            if isinstance(filename, (str, bytes, os.PathLike)) and not os.path.exists(filename):
                filename = _resolve_font_file(filename)
            return _orig_ttfont_init(self, name, filename, *args, **kwargs)
        TTFont.__init__ = _safe_ttfont_init
    except Exception:
        pass

    try:
        from PIL import ImageFont as _pil_image_font
        _orig_truetype = _pil_image_font.truetype
        def _safe_truetype(font=None, *args, **kwargs):
            try:
                return _orig_truetype(font, *args, **kwargs)
            except OSError:
                if isinstance(font, (str, bytes, os.PathLike)) and not os.path.exists(font):
                    resolver = globals().get("_devnuby_font_resolver")
                    if resolver:
                        return _orig_truetype(resolver(font), *args, **kwargs)
                raise
        _pil_image_font.truetype = _safe_truetype
    except Exception:
        pass

    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.lib import fonts as rl_fonts
        from reportlab.platypus import paraparser as rl_paraparser

        # 3. Graceful getFont & ps2tt/tt2ps fallback so ANY font name (even unregistered) never crashes ReportLab Paragraph/Canvas
        _orig_get_font = pdfmetrics.getFont
        _STD_FALLBACKS = {
            "times new roman": "Times-Roman",
            "times new roman-bold": "Times-Bold",
            "times new roman-italic": "Times-Italic",
            "times new roman-bolditalic": "Times-BoldItalic",
            "timesnewroman": "Times-Roman",
            "timesnewroman-bold": "Times-Bold",
            "georgia": "Times-Roman",
            "georgia-bold": "Times-Bold",
            "arial": "Helvetica",
            "arial-bold": "Helvetica-Bold",
            "arial-italic": "Helvetica-Oblique",
            "calibri": "Helvetica",
            "calibri-bold": "Helvetica-Bold",
            "courier new": "Courier",
            "courier new-bold": "Courier-Bold",
        }
        def _safe_get_font(font_name):
            try:
                return _orig_get_font(font_name)
            except Exception:
                key = str(font_name or "").strip().lower()
                is_serif = any(k in key for k in ("times", "georgia", "serif", "cambria", "garamond", "palatino", "caladea"))
                is_mono = any(k in key for k in ("courier", "consolas", "mono", "menlo", "fira code"))
                target_std = "Times-Roman" if is_serif else ("Courier" if is_mono else "Helvetica")
                if key in _STD_FALLBACKS:
                    target_std = _STD_FALLBACKS[key]
                elif "bold" in key and ("italic" in key or "oblique" in key):
                    target_std = "Times-BoldItalic" if is_serif else ("Courier-BoldOblique" if is_mono else "Helvetica-BoldOblique")
                elif "bold" in key:
                    target_std = "Times-Bold" if is_serif else ("Courier-Bold" if is_mono else "Helvetica-Bold")
                elif "italic" in key or "oblique" in key:
                    target_std = "Times-Italic" if is_serif else ("Courier-Oblique" if is_mono else "Helvetica-Oblique")
                resolved = _orig_get_font(target_std)
                try:
                    pdfmetrics._fonts[font_name] = resolved
                except Exception:
                    pass
                return resolved
        pdfmetrics.getFont = _safe_get_font

        _orig_ps2tt = rl_fonts.ps2tt
        def _safe_ps2tt(psfn):
            try:
                return _orig_ps2tt(psfn)
            except Exception:
                key = str(psfn or "").strip().lower()
                b = 1 if ("bold" in key or key.endswith("-b")) else 0
                i = 1 if ("italic" in key or "oblique" in key or key.endswith("-i") or key.endswith("-bi")) else 0
                fam = "times" if any(k in key for k in ("times", "georgia", "serif", "cambria", "garamond")) else ("courier" if ("courier" in key or "mono" in key or "consolas" in key) else "helvetica")
                return (fam, b, i)
        rl_fonts.ps2tt = _safe_ps2tt
        rl_paraparser.ps2tt = _safe_ps2tt

        _orig_tt2ps = rl_fonts.tt2ps
        def _safe_tt2ps(fn, b, i):
            try:
                return _orig_tt2ps(fn, b, i)
            except Exception:
                key = str(fn or "").strip().lower()
                fam = "times" if any(k in key for k in ("times", "georgia", "serif", "cambria", "garamond")) else ("courier" if ("courier" in key or "mono" in key or "consolas" in key) else "helvetica")
                return _orig_tt2ps(fam, b, i)
        rl_fonts.tt2ps = _safe_tt2ps
        rl_paraparser.tt2ps = _safe_tt2ps

        # Also patch Canvas.setFont so unknown psfontname resolves to registered fontName
        from reportlab.pdfgen.canvas import Canvas
        _orig_set_font = Canvas.setFont
        def _safe_set_font(self, psfontname, size, leading=None):
            try:
                return _orig_set_font(self, psfontname, size, leading)
            except Exception:
                resolved = _safe_get_font(psfontname)
                return _orig_set_font(self, resolved.fontName, size, leading)
        Canvas.setFont = _safe_set_font
    except Exception:
        pass
`;
