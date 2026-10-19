"""Fixed answer lines in Bahasa Melayu and Chinese (T-019).

Some caveats are fixed English sentences that the validator requires word for word (crossing
note, entrance note) or that helpers write (staff checks, unchecked items, rest gap, closures,
the road-without-sidewalk warning). A BM or 中文 answer used to keep them in English. After the
validator has passed the answer, `localize` rewrites each known sentence in the answer's frame
language. Numbers, names and dates are copied unchanged; anything not recognised stays as it is.
"""

import re
from collections.abc import Callable

# Attribute labels (townshiplens_spatial.attributes.ATTRIBUTE_LABELS + labels._EXTRA_ATTRIBUTES).
ATTRIBUTES = {
    "Steps": ("Anak tangga", "台阶"),
    "Step height (cm)": ("Tinggi anak tangga (cm)", "台阶高度（厘米）"),
    "Incline (%)": ("Kecerunan (%)", "坡度（%）"),
    "Width (m)": ("Lebar (m)", "宽度（米）"),
    "Ramp": ("Tanjakan", "坡道"),
    "Tactile paving": ("Laluan taktil", "盲道"),
    "Lighting": ("Lampu", "照明"),
    "Seating nearby": ("Tempat duduk berhampiran", "附近座位"),
    "Seating": ("Tempat duduk", "座位"),
    "Covered": ("Berbumbung", "有遮盖"),
    "Surface": ("Permukaan", "路面"),
    "Surface condition": ("Keadaan permukaan", "路面状况"),
    "Kerb": ("Bebendul", "路缘"),
    "Handrail": ("Pemegang tangan", "扶手"),
    "Crossing type": ("Jenis lintasan", "过街类型"),
    "Sidewalk": ("Laluan pejalan kaki", "人行道"),
    "Shelter": ("Tempat berteduh", "遮蔽处"),
    "Door type": ("Jenis pintu", "门的类型"),
    "Wheelchair access": ("Akses kerusi roda", "轮椅通行"),
    "Opening hours": ("Waktu buka", "开放时间"),
    "Flood": ("Banjir", "洪水"),
    "Existence": ("Kewujudan", "是否存在"),
    "Path type": ("Jenis laluan", "路径类型"),
}
# Unnamed element kinds (labels._EDGE_TYPES).
KINDS = {
    "footway": ("laluan pejalan kaki", "人行小路"),
    "sidewalk": ("laluan tepi jalan", "人行道"),
    "pedestrian path": ("laluan pejalan kaki", "步行道"),
    "crossing": ("lintasan", "过街处"),
    "set of steps": ("set anak tangga", "台阶"),
    "ramp": ("tanjakan", "坡道"),
    "path": ("laluan", "小路"),
    "street": ("jalan", "街道"),
    "track": ("denai", "土路"),
    "major road": ("jalan utama", "主干道"),
    "element": ("elemen", "路段"),
}
CROSSING_PARTS = {
    "with traffic lights": ("dengan lampu isyarat", "有红绿灯"),
    "marked, no traffic lights": ("bertanda, tiada lampu isyarat", "有标线、无红绿灯"),
    "unmarked": ("tidak bertanda", "无标线"),
    "where crossing is not allowed": ("di tempat melintas tidak dibenarkan", "不允许过街"),
    "with no recorded crossing type": ("tanpa jenis lintasan direkodkan", "未记录过街类型"),
}
CLOSURE_REASONS = {
    "works": ("kerja-kerja", "施工"),
    "event": ("acara", "活动"),
    "flooding": ("banjir", "水浸"),
    "other reason": ("sebab lain", "其他原因"),
    "reason not stated": ("sebab tidak dinyatakan", "未说明原因"),
}
_I = {"ms": 0, "zh": 1}


def _pick(table: dict[str, tuple[str, str]], key: str, lang: str) -> str:
    row = table.get(key)
    return row[_I[lang]] if row else key


def _element(el: str, lang: str) -> str:
    """ "an unnamed footway" -> "laluan pejalan kaki tanpa nama" / "无名人行小路"; names stay."""
    m = re.fullmatch(r"(?:an |a )?unnamed (.+)", el.strip(), re.IGNORECASE)
    if not m:
        return el
    kind = _pick(KINDS, m.group(1).lower(), lang)
    return f"{kind} tanpa nama" if lang == "ms" else f"无名{kind}"


def _attrs(text: str, lang: str) -> str:
    """ "Steps, Incline (%) and Width (m)" -> each label translated, joined in the language."""
    parts = re.split(r",\s*|\s+and\s+", text)
    out = [_pick(ATTRIBUTES, p.strip(), lang) for p in parts if p.strip()]
    if lang == "zh":
        return "、".join(out)
    return out[0] if len(out) == 1 else ", ".join(out[:-1]) + " dan " + out[-1]


def _plural(word: str) -> str:
    return rf"{word}s?"


Rule = tuple[re.Pattern[str], Callable[[re.Match[str], str], str]]
RULES: list[Rule] = []


def rule(pattern: str):
    def wrap(fn):
        RULES.append((re.compile(pattern, re.IGNORECASE), fn))
        return fn

    return wrap


@rule(r"Asked the township team to check this item(?=[.;,]|$)")
def _ask_one(m, lang):
    return "Pasukan township diminta menyemak item ini" if lang == "ms" else "已请社区团队核查此项"


@rule(r"Asked the township team to check all (\d+) unchecked items(?=[.;,]|\s|$)")
def _ask_all(m, lang):
    k = m.group(1)
    if lang == "ms":
        return f"Pasukan township diminta menyemak kesemua {k} item yang belum disemak"
    return f"已请社区团队核查全部{k}项未核实的项目"


@rule(r"Asked the township team to check (\d+) of the (\d+) unchecked items(?=[.;,]|\s|$)")
def _ask_some(m, lang):
    k, n = m.group(1), m.group(2)
    if lang == "ms":
        return f"Pasukan township diminta menyemak {k} daripada {n} item yang belum disemak"
    return f"已请社区团队核查{n}项未核实项目中的{k}项"


@rule(r"This route uses (\d+) road crossings?: (.+?)\.(?=\s|$)")
def _crossings(m, lang):
    parts = []
    for p in re.split(r", (?=\d)", m.group(2)):
        pm = re.fullmatch(r"(\d+) (.+?)( \(map data, not checked\))?", p.strip())
        if not pm:
            return m.group(0)  # not the crossing_note shape: leave it
        k, kind, unchecked = pm.group(1), _pick(CROSSING_PARTS, pm.group(2), lang), pm.group(3)
        if lang == "ms":
            parts.append(f"{k} {kind}" + (" (data peta, belum disemak)" if unchecked else ""))
        else:
            parts.append(f"{k}处{kind}" + ("（地图数据，未核实）" if unchecked else ""))
    n = m.group(1)
    if lang == "ms":
        return f"Laluan ini menggunakan {n} lintasan jalan: {', '.join(parts)}."
    return f"此路线经过{n}处过街：{'，'.join(parts)}。"


@rule(r"Route (starts|ends) at the nearest mapped path to (.+?); its entrance is not mapped\.?")
def _entrance(m, lang):
    start, place = m.group(1).lower() == "starts", m.group(2)
    if lang == "ms":
        verb = "bermula" if start else "berakhir"
        return (
            f"Laluan {verb} di laluan dipetakan terdekat dengan {place}; "
            "pintu masuknya belum dipetakan."
        )
    where = "起点" if start else "终点"
    return f"路线{where}是离{place}最近的已绘制路径；其入口尚未绘制。"


@rule(r"Not checked yet: (.+?) on (.+?)(?= \(x\d+\)|[.;]|$)")
def _unchecked(m, lang):
    attrs, el = _attrs(m.group(1), lang), _element(m.group(2), lang)
    return f"Belum disemak: {attrs} pada {el}" if lang == "ms" else f"尚未核实：{el}的{attrs}"


@rule(r"and (\d+) more unchecked items?")
def _more(m, lang):
    n = m.group(1)
    return f"dan {n} item lagi belum disemak" if lang == "ms" else f"另有{n}项未核实"


@rule(r"and (\d+) more possibly flooded paths?")
def _more_flood(m, lang):
    n = m.group(1)
    return f"dan {n} laluan lagi mungkin dinaiki air" if lang == "ms" else f"另有{n}段路径可能被淹"


@rule(r"^([^:\n]+?): possibly flooded in this indicative scenario")
def _flood_line(m, lang):
    el = _element(m.group(1), lang)
    if lang == "ms":
        return f"{el[:1].upper()}{el[1:]}: mungkin dinaiki air dalam senario indikatif ini"
    return f"{el}：在此示意情景中可能被淹"


@rule(r"Longest stretch without a rest point is about (\d+) m \(limit (\d+(?:\.\d+)?) m\)\.?")
def _rest_gap(m, lang):
    gap, limit = m.group(1), m.group(2)
    if lang == "ms":
        return f"Regangan terpanjang tanpa tempat rehat ialah kira-kira {gap} m (had {limit} m)."
    return f"最长无休息点路段约{gap}米（上限{limit}米）。"


@rule(r"Rest point not checked yet: (.+?)(?=[.;]|$)")
def _rest_point(m, lang):
    name = m.group(1)
    return f"Tempat rehat belum disemak: {name}" if lang == "ms" else f"休息点尚未核实：{name}"


@rule(
    r"About (\d+) m follows road centre lines without a mapped sidewalk[;.] "
    r"[Ss]idewalk access is not (?:verified|checked yet)"
)
def _road(m, lang):
    n = m.group(1)
    if lang == "ms":
        return (
            f"Kira-kira {n} m mengikut garis tengah jalan tanpa laluan pejalan kaki dipetakan; "
            "akses laluan pejalan kaki belum disahkan"
        )
    return f"约{n}米沿道路中线而行，没有已绘制的人行道；人行道通行情况未核实"


@rule(r"Closed \(staff report\): (.+?) until (further notice|\d{1,2} \w{3} \d{4}) — (.+?)$")
def _closure(m, lang):
    name, until, reason = _element(m.group(1), lang), m.group(2), m.group(3).rstrip(".")
    reason = _pick(CLOSURE_REASONS, reason, lang)
    if lang == "ms":
        until = "hingga notis lanjut" if until == "further notice" else f"hingga {until}"
        return f"Ditutup (laporan kakitangan): {name} {until} — {reason}"
    until = "直至另行通知" if until == "further notice" else f"至{until}"
    return f"已关闭（工作人员报告）：{name}，{until} — {reason}"


@rule(r"(route )?confirmed \(on demo values, not yet surveyed\)")
def _demo_confirmed(m, lang):
    if lang == "ms":
        return ("laluan " if m.group(1) else "") + "disahkan (pada nilai demo, belum ditinjau)"
    return ("路线" if m.group(1) else "") + "已确认（基于演示数据，尚未实地调查）"


@rule(r"^demo values, not yet surveyed(?=[.;]?$)")
def _demo_only(m, lang):
    return "Nilai demo, belum ditinjau" if lang == "ms" else "演示数据，尚未实地调查"


@rule(r"(.+?) is about (\d+) m from the nearest mapped road; distance and time stop at the road")
def _road_gap(m, lang):
    place, n = m.group(1), m.group(2)
    if lang == "ms":
        return (
            f"{place} kira-kira {n} m dari jalan dipetakan terdekat; jarak dan masa berhenti "
            "di jalan itu"
        )
    return f"{place}距离最近的已绘制道路约{n}米；距离和时间只算到该道路"


@rule(
    r"Drive routes: mapped one-way tags applied; legal turn restrictions and changing "
    r"directions not modelled; indicative only, never confirmed\.?"
)
def _drive(m, lang):
    if lang == "ms":
        return (
            "Laluan memandu: tanda sehala dalam peta digunakan; larangan membelok dan arah "
            "yang berubah tidak dimodelkan; indikatif sahaja, tidak pernah disahkan."
        )
    return "驾车路线：已采用地图上的单行标记；未考虑转弯限制和方向变化；仅供参考，从不视为已确认。"


def localize(text: str, lang: str) -> str:
    """`text` with every known fixed English sentence in `lang` ("ms" or "zh"); English and
    unknown languages pass through unchanged."""
    if lang not in _I or not text:
        return text
    text = text.replace(
        "Estimated from map data (OpenStreetMap path types and tags), not checked on site",
        "Anggaran daripada data peta (jenis laluan dan tag OpenStreetMap), belum disemak di tapak"
        if lang == "ms"
        else "根据地图数据（OpenStreetMap路径类型和标签）估计，尚未实地核实",
    )
    text = text.replace(
        "Likely OK sections are estimated from map data, not checked on site.",
        (
            "Bahagian yang berkemungkinan boleh dilalui ialah anggaran daripada peta, "
            "belum diperiksa di tapak."
        )
        if lang == "ms"
        else "估计可通行的路段基于地图数据，尚未实地核实。",
    )
    for pattern, fn in RULES:
        text = pattern.sub(lambda m, fn=fn: fn(m, lang), text)
    if lang == "zh":  # Chinese punctuation after Chinese text
        text = re.sub(r"(?<=[\u3400-\u9fff）])\.(?=\s|$)", "。", text)
        text = re.sub(r"(?<=[\u3400-\u9fff）]); ", "；", text)
    return text
