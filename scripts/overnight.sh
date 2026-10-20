#!/usr/bin/env bash
# Keep one local engineer working overnight, across usage-limit resets.
#
# Usage (run inside tmux, one window per engineer, after closing that engineer's interactive session):
#   scripts/overnight.sh codex  ~/path/to/SunNewBee-backend 08:00
#   scripts/overnight.sh claude ~/path/to/SunNewBee-ai      08:00
#
# Each round resumes the engineer's latest session in its worktree with ROUND_PROMPT.
# A round that fails within 2 minutes is treated as "usage limit reached": wait 20 minutes, try again.
# A failed try costs nothing. A round with no new commit on the branch waits 30 minutes (idle or blocked). Stops at the end time, when the agent prints NOTHING LEFT,
# after MAX_ROUNDS rounds, or when the file <worktree>/.overnight-stop exists.
# Log: <worktree>/.overnight-<agent>.log (add .overnight-* to .git/info/exclude).
set -u

AGENT=${1:?codex or claude}
DIR=${2:?worktree path}
UNTIL=${3:-08:00}
MAX_ROUNDS=${MAX_ROUNDS:-40}
LIMIT_WAIT=${LIMIT_WAIT:-1200}
QUICK_FAIL=${QUICK_FAIL:-120}
IDLE_WAIT=${IDLE_WAIT:-1800}

ROUND_PROMPT=${ROUND_PROMPT:-'Overnight round, no human is watching. Read the board README ("Rounds", "Overnight") and your task files on yunzhe/agent-board. Take the next open item for you in the "Audit P1 fixes" table on BOARD.md, then your other open tasks. Work in small steps. Commit and push your own branch after each step and log on your task file. Run the CI checks that match your change, except e2e. Live model calls only inside your SPEND.md limit, at most 10 questions per round, and log the cost. Never push to main or to another engineer branch. If you are blocked, log why and take the next item. When no item is left, print NOTHING LEFT as your last line.'}

cd "$DIR" || exit 1
LOG="$DIR/.overnight-$AGENT.log"
now() { date +%s; }
stamp() { date -u '+%F %H:%M:%S UTC'; }

end=$(date -d "$UNTIL" +%s) || exit 1
[ "$end" -le "$(now)" ] && end=$(date -d "tomorrow $UNTIL" +%s)
echo "$(stamp) start agent=$AGENT until=$(date -d "@$end" '+%F %H:%M') max_rounds=$MAX_ROUNDS" >>"$LOG"

round=0
while [ "$(now)" -lt "$end" ] && [ ! -f "$DIR/.overnight-stop" ] && [ "$round" -lt "$MAX_ROUNDS" ]; do
  round=$((round + 1))
  last=$(mktemp)
  start=$(now)
  head0=$(git -C "$DIR" rev-parse HEAD 2>/dev/null)
  echo "$(stamp) round $round start" >>"$LOG"
  case "$AGENT" in
    codex)
      # Run from the parent folder: Codex keeps a writable root's own .git read-only.
      (cd "$(dirname "$DIR")" && codex exec resume --last -o "$last" "$ROUND_PROMPT") >>"$LOG" 2>&1
      rc=$?
      ;;
    claude)
      claude -p --continue --permission-mode auto --permission-prompts none \
        "$ROUND_PROMPT" >"$last" 2>>"$LOG"
      rc=$?
      cat "$last" >>"$LOG"
      ;;
    *) echo "unknown agent: $AGENT" >&2; exit 2 ;;
  esac
  took=$(( $(now) - start ))
  echo "$(stamp) round $round end rc=$rc took=${took}s" >>"$LOG"

  if grep -q "NOTHING LEFT" "$last"; then
    echo "$(stamp) agent reports NOTHING LEFT, stopping" >>"$LOG"
    rm -f "$last"
    break
  fi
  rm -f "$last"

  if [ "$rc" -ne 0 ] && [ "$took" -lt "$QUICK_FAIL" ]; then
    echo "$(stamp) quick failure, assuming usage limit; next try in ${LIMIT_WAIT}s" >>"$LOG"
    sleep "$LIMIT_WAIT"
  elif [ "$(git -C "$DIR" rev-parse HEAD 2>/dev/null)" = "$head0" ]; then
    echo "$(stamp) no new commit on the branch (idle or blocked); next try in ${IDLE_WAIT}s" >>"$LOG"
    sleep "$IDLE_WAIT"
  else
    sleep 30
  fi
done
echo "$(stamp) stop after $round rounds" >>"$LOG"
