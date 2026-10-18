"""Shared resident-assistant scope policy; staff engines are not gated here."""

import re

ACCESS_FLOOD_TOOLS = frozenset(
    {
        "find_place",
        "get_place_details",
        "plan_route",
        "nearby_amenities",
        "get_closures",
        "create_verification_request",
        "list_flood_scenarios",
        "affected_places",
        "list_evacuation_centres",
    }
)

# Clearly removed features (scope B+, T-013). Nothing else is refused before the model: route
# and place questions are answered however they are worded, and the model declines other
# off-topic questions itself (prompt rule 10). Phrases are kept narrow so a real access or
# evacuation question is never caught ("what if the path is closed, how do I get to the mall?",
# "what happens to residents if the river rises?", "the town hall").
REMOVED = re.compile(
    r"recycl|e[-_ ]?waste|rubbish|garbage|\btrash\b|\bwaste\b|batter(?:y|ies)|"
    r"kitar semula|sampah|bateri|回收|垃圾|废物|电池|"
    r"what.?if (?:we|you|they|staff|mbsa|the (?:council|township|developer|team))\b.{0,100}"
    r"(?:build|close|change|raise|add|fix|widen|install|remove)|\bimagin|hypothetical|"
    r"if (?:we|you|staff) (?:build|add|close|verify)|build.{0,30}ramp|"
    r"bina.{0,50}tanjakan|bagaimana jika (?:kita|kami|mereka|majlis|pihak)\b.{0,80}"
    r"(?:bina|tutup|ubah)|andaikan.{0,80}(?:bina|tutup|ubah)|如果.{0,80}(?:建造|修建|改造)|"
    r"如果(?:我们|你们|他们|政府|市政局).{0,40}封闭|"
    r"假设.{0,80}(?:坡道|修建|封闭)|simulate_what_if|suggest_interventions|"
    r"verify (?:first|next)|survey.{0,40}first|survey plan|"
    r"which (?:facts|checks|things).{0,40}(?:verify|first)|"
    r"plan_verifications|sahkan dahulu|semak dahulu|tinjau dahulu|先核实|先验证|优先核实|"
    r"tipping|at (?:which|what) (?:river|water) (?:level|stage).{0,80}"
    r"(?:break|cut|lose|stop|fail|unreachable)|"
    r"(?:river|water) level.{0,70}(?:break|lose)|river_tipping_point|"
    r"pada paras.{0,80}(?:terputus|putus)|titik kritikal|临界|哪个水位.{0,30}(?:中断|断|不通)|"
    r"水位.{0,30}中断|rising.river rollout|rising_river_rollout|stage by stage|river rollout|"
    r"penduduk.{0,60}setiap paras|每个水位|逐级|"
    r"fix.?it|which.{0,25}changes?.{0,60}help|best.{0,25}(?:change|fix)|find_fixes|"
    r"pembaikan terbaik|perubahan.{0,30}(?:terbaik|membantu)|最佳改造|哪些改造|"
    r"rehears|elmina day|synthetic residents|simulated day|normal weekday|"
    r"day_rehearsal|day_test_change|latihan.{0,60}(?:penduduk|acara)|"
    r"simulasi.{0,30}hari|演练|模拟居民|居民的一天|"
    r"\brecipe\b|\bcook\b|resipi|食谱",
    re.IGNORECASE,
)
_GREET = (
    r"hi+|hello|hey|hai|helo|halo|yo|good (?:morning|afternoon|evening|day)|"
    r"selamat (?:pagi|tengah hari|petang|malam)|apa khabar|assalamualaikum|salam|"
    r"thanks?(?: you)?(?: (?:so|very) much)?|thank you|tq|terima kasih|"
    r"你好|您好|嗨|哈喽|早上好|早安|下午好|晚上好|谢谢|多谢|感谢"
)
_THANKS = re.compile(r"thank|\btq\b|terima kasih|谢|感谢", re.IGNORECASE)
# A message that is only greetings or thanks (optionally "there" / the assistant's name).
GREETING = re.compile(
    rf"^\s*(?:(?:{_GREET})(?:\s+(?:there|all|everyone|townshiplens))?[\s,.!?~:)(😊👋🙏！。，？～]*)+$",
    re.IGNORECASE,
)


def outside_scope(question: str) -> bool:
    """True only for a clearly removed feature (refused before the model and any tool)."""
    return bool(REMOVED.search(question))


def is_greeting(question: str) -> bool:
    return bool(GREETING.match(question or ""))


def _lang(question: str) -> str:
    if re.search(r"[㐀-鿿]", question):
        return "zh"
    if re.search(
        r"\b(?:boleh|saya|apakah|apa|di mana|bagaimana|kitar|sampah|penduduk|jika|resipi|"
        r"pada|paras|berapa|tandas|perubahan|fakta|laluan|kerusi|tanjakan|tolong|hai|helo|"
        r"selamat|khabar|terima|kasih|assalamualaikum|salam)\b",
        question,
        re.I,
    ):
        return "ms"
    return "en"


_OFFER = {
    "en": "I can help with routes and places anywhere in Elmina (for wheelchairs, strollers "
    "and older adults), place facts, nearby amenities, closures, and indicative flood "
    "evacuation scenarios.",
    "ms": "Saya boleh membantu dengan laluan dan tempat di seluruh Elmina (untuk kerusi roda, "
    "kereta sorong dan warga emas), maklumat tempat, kemudahan berdekatan, penutupan, dan "
    "senario pemindahan banjir indikatif.",
    "zh": "我可以查询 Elmina 各处的路线和地点（轮椅、婴儿车和长者），地点信息、附近设施、"
    "封闭情况，以及示意性洪水疏散情景。",
}


def refusal_text(question: str) -> str:
    lang = _lang(question)
    head = {
        "en": "Sorry, that is outside what I can check.",
        "ms": "Maaf, itu di luar perkara yang boleh saya semak.",
        "zh": "抱歉，这超出我能核实的范围。",
    }[lang]
    return f"{head}{'' if lang == 'zh' else ' '}{_OFFER[lang]}"


def greeting_text(question: str) -> str:
    lang = _lang(question)
    thanks = bool(_THANKS.search(question))
    head = {
        "en": ("You're welcome!" if thanks else "Hello!"),
        "ms": ("Sama-sama!" if thanks else "Hai!"),
        "zh": ("不客气！" if thanks else "你好！"),
    }[lang]
    ask = {
        "en": "Where would you like to go?",
        "ms": "Ke mana anda mahu pergi?",
        "zh": "你想去哪里？",
    }[lang]
    sep = "" if lang == "zh" else " "
    return f"{head}{sep}{_OFFER[lang]}{sep}{ask}"


def scoped_instructions(system: str, scope: str) -> str:
    if scope == "all":
        return system
    # Preserve the common honesty/output contract; legacy feature instructions start at 13.
    common = system.split("\n13. What-if", 1)[0]
    common = common.replace("flood what-if scenarios and recycling", "indicative flood evacuation")
    common = common.replace(
        "routes, places, flood scenarios, recycling points in Elmina",
        "routes, places and indicative flood evacuation in Elmina",
    )
    return (
        "PRODUCT SCOPE: access_flood. Cover access (routes, places, nearby amenities, "
        "closures, verification requests for gaps) and indicative flood evacuation anywhere "
        "in Elmina. Never refuse a route or place question because of how it is worded: "
        "resolve the places with find_place and answer. The detailed study area is Elmina "
        "Urban Park + Elmina Lakeside Mall frontage; outside it the app adds a caveat that "
        "path and place facts come from OpenStreetMap only, so do not write that caveat "
        "yourself. These features are removed: waste and recycling, imagined changes "
        "(what-if), tipping points, population rollouts, fix-it searches, survey ranking and "
        "simulated days; politely refuse them without calling a tool. Questions unrelated "
        "to Elmina access or flood evacuation get rule 10.\n\n" + common
    )
