export type Lang = "en" | "ms" | "zh";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ms", label: "Bahasa Melayu" },
  { id: "zh", label: "中文" },
];

export type AdvisoryInput = { scenarioLabel: string; likely: number; possible: number };

/** Staff-editable draft. Never claims safety; always carries the scenario and guidance phrases. */
export function buildAdvisory(lang: Lang, i: AdvisoryInput): string {
  switch (lang) {
    case "ms":
      return [
        `Makluman awam (DRAF): Senario banjir "${i.scenarioLabel}" ialah senario tunjuk arah, bukan ramalan (indicative scenario, not a forecast).`,
        `Mengikut senario ini, ${i.likely} tempat mungkin besar kemungkinan terputus dan ${i.possible} tempat berkemungkinan terputus.`,
        "Sila ikut panduan rasmi MBSA / JPS / NADMA dan semak pusat pemindahan rasmi sebelum bergerak.",
      ].join("\n\n");
    case "zh":
      return [
        `居民通告（草稿）：洪水情景“${i.scenarioLabel}”为示意情景，并非预报（indicative scenario, not a forecast）。`,
        `根据该情景，约有 ${i.likely} 处地点很可能被阻断，${i.possible} 处地点可能被阻断。`,
        "请遵循 MBSA / JPS / NADMA 官方指引（follow official MBSA / JPS / NADMA guidance），出行前请核实官方疏散中心。",
      ].join("\n\n");
    default:
      return [
        `Resident advisory (DRAFT): The flood scenario "${i.scenarioLabel}" is an indicative scenario, not a forecast.`,
        `Under this scenario, ${i.likely} places are likely to be cut off and ${i.possible} possibly cut off.`,
        "Please follow official MBSA / JPS / NADMA guidance and check official evacuation centres before travelling.",
      ].join("\n\n");
  }
}
