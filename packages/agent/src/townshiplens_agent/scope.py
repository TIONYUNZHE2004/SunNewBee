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

# Explicit removed intents take priority over place/access words in the same question.
REMOVED = re.compile(
    r"recycl|e[-_ ]?waste|rubbish|garbage|\btrash\b|\bwaste\b|batter(?:y|ies)|"
    r"kitar semula|sampah|bateri|回收|垃圾|废物|电池|"
    r"what.?if.{0,120}(?:build|close|change|raise|add|fix)|\bimagin|hypothetical|"
    r"if (?:we|you|staff) (?:build|add|close|verify)|build.{0,30}ramp|"
    r"bina.{0,50}tanjakan|bagaimana jika.{0,80}(?:bina|tutup|ubah)|"
    r"andaikan.{0,80}(?:bina|tutup|ubah)|如果.{0,80}(?:建造|修建|封闭|改造)|"
    r"假设.{0,80}(?:坡道|修建|封闭)|simulate_what_if|suggest_interventions|"
    r"verify (?:first|next)|survey.{0,40}first|survey plan|"
    r"which (?:facts|checks|things).{0,40}(?:verify|first)|"
    r"plan_verifications|sahkan dahulu|semak dahulu|tinjau dahulu|先核实|先验证|优先核实|"
    r"tipping|at (?:which|what) river (?:level|stage)|"
    r"(?:river|water) level.{0,70}(?:break|lose)|river_tipping_point|"
    r"pada paras.{0,80}(?:terputus|putus)|titik kritikal|临界|哪个水位|水位.{0,30}中断|"
    r"what happens to (?:residents|people)|rising.river rollout|rising_river_rollout|"
    r"stage by stage|river rollout|"
    r"penduduk.{0,60}setiap paras|随着河水|居民.{0,30}水位上升|"
    r"fix.?it|which.{0,25}changes?.{0,60}help|best.{0,25}(?:change|fix)|find_fixes|"
    r"pembaikan terbaik|perubahan.{0,30}(?:terbaik|membantu)|最佳改造|哪些改造|"
    r"rehears|elmina day|synthetic residents|simulated day|normal weekday|town.hall|"
    r"day_rehearsal|day_test_change|latihan.{0,60}(?:penduduk|acara)|"
    r"simulasi.{0,30}hari|演练|模拟居民|居民的一天|"
    r"\brecipe\b|\bcook\b|resipi|食谱",
    re.IGNORECASE,
)
ACCESS_OR_FLOOD = re.compile(
    r"access|route|step|wheelchair|stroller|pram|kerusi|sorong|walk|jalan|laluan|tangga|"
    r"entrance|pintu|mall|\bpark\b|playground|kiosk|toilet|tandas|bench|seat|ramp|slope|"
    r"width|incline|clos(?:ed|ure)|tutup|ticket|verif|flood|river|banjir|sungai|evac|"
    r"\breach\b|stairs|shelter|\bfacts\b|\bplaces?\b|\bdetails\b|centre|center|"
    r"\bpps\b|pemindahan|pusat|maklumat|\btempat\b|lebar|cerun|pembukaan|"
    r"\bstage\b|\bwater\b|where can i go|how do i get|take me to|"
    r"疏散|避难|撤离|洪水|河|水位|入口|路线|轮椅|婴儿车|台阶|厕所|座椅|坡道|核实|关闭|工单|"
    r"商场|公园|停车场|地点|通行|通道|楼梯|扶手|盲道|宽度|斜坡|营业|座位|怎么走",
    re.IGNORECASE,
)


def outside_scope(question: str, *, has_history: bool = False) -> bool:
    return bool(REMOVED.search(question)) or (
        not has_history and not ACCESS_OR_FLOOD.search(question)
    )


def refusal_text(question: str) -> str:
    if re.search(r"[\u3400-\u9fff]", question):
        return (
            "抱歉，这超出我能核实的范围。我可以查询 Elmina Urban Park 和 Elmina Lakeside Mall "
            "周边的通行信息及示意洪水疏散情景。"
        )
    if re.search(
        r"\b(?:boleh|saya|apakah|apa|di mana|bagaimana|kitar|sampah|penduduk|jika|resipi|"
        r"pada|paras|berapa|tandas|perubahan|fakta|laluan|kerusi|tanjakan|tolong)\b",
        question,
        re.I,
    ):
        return (
            "Maaf, itu di luar perkara yang boleh saya semak. Saya boleh membantu dengan "
            "akses dan senario pemindahan banjir indikatif sekitar Elmina Urban Park "
            "dan Elmina Lakeside Mall."
        )
    return (
        "Sorry, that is outside what I can check. I can help with access and indicative "
        "flood evacuation around Elmina Urban Park and Elmina Lakeside Mall frontage."
    )


def scoped_instructions(system: str, scope: str) -> str:
    if scope == "all":
        return system
    # Preserve the common honesty/output contract; legacy feature instructions start at 13.
    common = system.split("\n13. What-if", 1)[0]
    common = common.replace("flood what-if scenarios and recycling", "indicative flood evacuation")
    common = common.replace(
        "routes, places, flood scenarios, recycling points in Elmina",
        "access and indicative flood evacuation in the deep spot",
    )
    return (
        "PRODUCT SCOPE: access_flood. Cover access and indicative flood evacuation only "
        "around Elmina Urban Park + Elmina Lakeside Mall frontage. Resolve ambiguity "
        "instead of assuming a place elsewhere. Evacuation candidates may be outside "
        "the deep spot, but journeys start from the deep spot. All other features, "
        "including waste, imagined changes, tipping points, population rollouts, "
        "fix-it searches, survey ranking and simulated days, are outside what you can "
        "check: politely refuse without calling a tool.\n\n" + common
    )
