/**
 * The checked answer text, split into display blocks (owner, 21 Oct: one long run of text was hard
 * to read). Pure and lossless: every word of the text is in exactly one block, in order, so what the
 * validator checked is what the resident reads. The agent writes a fixed shape (packages/agent
 * steps.py, labels.py): an optional "Route status: X" line, a summary, numbered steps, then
 * "Worth knowing:" and "•" notes; anything else stays a plain paragraph.
 */
export type StatusTone = "ok" | "warn" | "bad" | "gap";

export interface Step {
  /** The step's own words, without its number and trailing note. */
  text: string;
  /** The trailing parenthetical, e.g. "not checked yet" (shown as a tag). */
  note?: string;
  /** "… 6 more steps are not listed here (shortened directions)." */
  elided?: boolean;
}

export type AnswerBlock =
  | { kind: "status"; label: string; value: string; tone: StatusTone }
  | { kind: "para"; text: string }
  | { kind: "steps"; steps: Step[] }
  | { kind: "notes"; title?: string; items: string[] };

const STATUS = /^(Route status):\s*(.+)$/;
const STEP = /^(\d+)\.\s+(.*)$/;
const BULLET = /^[•\-*]\s+(.*)$/;
const HEADING = /^(Worth knowing):$/;
/** A step's trailing note: "(not checked yet)." or "(likely OK, estimated from map data)". */
const NOTE = /^(.*?)\s*\(([^()]+)\)(\.?)$/;

export function statusTone(value: string): StatusTone {
  const v = value.toLowerCase();
  if (/no mapped connection|data gap|no_data|no data/.test(v)) return "gap";
  if (/blocked|cut|flooded/.test(v)) return "bad";
  if (/partly|unverified|not checked|likely|estimated|demo/.test(v)) return "warn";
  if (/confirmed/.test(v)) return "ok";
  return "warn";
}

function step(body: string): Step {
  if (body.startsWith("…")) return { text: body, elided: true };
  const m = NOTE.exec(body);
  if (!m?.[1] || !m[2]) return { text: body };
  return { text: `${m[1]}${m[3] ?? ""}`, note: m[2] };
}

export function answerBlocks(text: string): AnswerBlock[] {
  const out: AnswerBlock[] = [];
  const last = () => out[out.length - 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const st = STATUS.exec(line);
    if (st?.[1] && st[2] && out.length === 0) {
      out.push({ kind: "status", label: st[1], value: st[2], tone: statusTone(st[2]) });
      continue;
    }
    const sp = STEP.exec(line);
    if (sp?.[2] !== undefined) {
      const prev = last();
      if (prev?.kind === "steps") prev.steps.push(step(sp[2]));
      else out.push({ kind: "steps", steps: [step(sp[2])] });
      continue;
    }
    const hd = HEADING.exec(line);
    if (hd?.[1]) {
      out.push({ kind: "notes", title: hd[1], items: [] });
      continue;
    }
    const bl = BULLET.exec(line);
    if (bl?.[1] !== undefined) {
      const prev = last();
      if (prev?.kind === "notes") prev.items.push(bl[1]);
      else out.push({ kind: "notes", items: [bl[1]] });
      continue;
    }
    out.push({ kind: "para", text: line });
  }
  return out;
}

/** Every word of a block, as the answer text had it (tests: the split is lossless). */
export function blockWords(b: AnswerBlock): string {
  switch (b.kind) {
    case "status":
      return `${b.label}: ${b.value}`;
    case "para":
      return b.text;
    case "steps":
      return b.steps
        .map((s) => (s.note ? `${s.text.replace(/\.$/, "")} (${s.note})` : s.text))
        .join(" ");
    case "notes":
      return [b.title ? `${b.title}:` : "", ...b.items].filter(Boolean).join(" ");
  }
}
