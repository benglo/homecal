#!/usr/bin/env bash
# Walk the noise catalog, prompt for a source file + URL per entry, and
# normalise into kiosk/voice/homecal_voice/clips/noises/. Updates
# SOURCES.md inline.
#
# Usage:  bash kiosk/voice/scripts/import-noises.sh
# Recommended source: https://pixabay.com/sound-effects/ (no account needed,
# permissive license). Freesound CC0 filter is the backup.

set -euo pipefail

# Resolve project paths regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CATALOG="$PROJECT_ROOT/kiosk/voice/homecal_voice/catalogs/noises.json"
CLIPS_DIR="$PROJECT_ROOT/kiosk/voice/homecal_voice/clips/noises"
SOURCES_MD="$CLIPS_DIR/SOURCES.md"

# Fixed entry order — matches the catalog.
NAMES=(fart burp chicken cow pig dog cat lion sneeze raspberry drum fanfare)

# Pretty colours if stdout is a tty.
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  RED=$'\033[31m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; GREEN=''; YELLOW=''; RED=''; BLUE=''; RESET=''
fi

command -v ffmpeg >/dev/null || {
  echo "${RED}ffmpeg not found. Install: sudo apt install ffmpeg${RESET}" >&2
  exit 1
}

count_total=${#NAMES[@]}
count_done=0
count_skipped=0

is_placeholder() {
  # Treat a file as a placeholder if it doesn't exist or is < 1KB.
  local f="$1"
  [[ ! -s "$f" ]] || (( $(stat -c%s "$f") < 1024 ))
}

print_status() {
  local name="$1"
  local path="$CLIPS_DIR/${name}.mp3"
  if is_placeholder "$path"; then
    printf "%s  %s%-12s%s placeholder\n" "$DIM" "$YELLOW" "$name" "$RESET"
  else
    local size
    size=$(stat -c%s "$path")
    printf "%s  %s%-12s%s real (%d bytes)\n" "$DIM" "$GREEN" "$name" "$RESET" "$size"
  fi
}

# Replace the row for `name` in SOURCES.md with the supplied values.
update_sources_md() {
  local name="$1" url="$2" creator="$3" notes="$4"
  local row="| ${name}.mp3 | ${url} | ${creator} | CC0 | ${notes} |"

  # Find the line that starts with "| <name>.mp3" and replace.
  if grep -q "^| ${name}\.mp3 " "$SOURCES_MD"; then
    # Use a temp file to avoid in-place sed quirks across distros.
    awk -v name="${name}.mp3" -v repl="$row" '
      $0 ~ "^\\| " name " " { print repl; next }
      { print }
    ' "$SOURCES_MD" > "$SOURCES_MD.tmp" && mv "$SOURCES_MD.tmp" "$SOURCES_MD"
  else
    echo "${RED}WARNING: no row for ${name}.mp3 in SOURCES.md — appending${RESET}" >&2
    echo "$row" >> "$SOURCES_MD"
  fi
}

normalise_clip() {
  local input="$1" output="$2"
  # mono, 16kHz, ≤2s, 64kbps MP3. -y overwrites.
  ffmpeg -loglevel error -i "$input" -ar 16000 -ac 1 -t 2 -b:a 64k -y "$output"
}

echo
echo "${BOLD}homecal noise catalog import${RESET}"
echo "${DIM}Recommended source: https://pixabay.com/sound-effects/${RESET}"
echo "${DIM}Target: $CLIPS_DIR${RESET}"
echo

echo "${BOLD}Current state:${RESET}"
for n in "${NAMES[@]}"; do print_status "$n"; done
echo

echo "${BOLD}Working through ${count_total} entries.${RESET}"
echo "${DIM}For each, paste the downloaded file path (drag-and-drop into the terminal works),"
echo "the source URL, and the creator handle. Type 'skip' to leave a placeholder,"
echo "or 'q' to quit and save progress.${RESET}"
echo

for name in "${NAMES[@]}"; do
  target="$CLIPS_DIR/${name}.mp3"

  echo "${BLUE}── ${name} ──${RESET}"
  if ! is_placeholder "$target"; then
    read -r -p "  Already imported. Replace? [y/N] " replace
    if [[ "$replace" != "y" && "$replace" != "Y" ]]; then
      echo "  ${DIM}keeping existing${RESET}"
      ((count_done++)) || true
      echo
      continue
    fi
  fi

  read -r -p "  Source file (or skip / q): " input
  case "$input" in
    q|Q|quit|exit) echo "  ${YELLOW}stopping early${RESET}"; break ;;
    skip|s|"") echo "  ${YELLOW}skipped${RESET}"; ((count_skipped++)) || true; echo; continue ;;
  esac

  # Strip surrounding quotes if dragged in from a file manager.
  input="${input#\"}"; input="${input%\"}"
  input="${input#\'}"; input="${input%\'}"
  # Expand a leading ~ to $HOME.
  input="${input/#\~/$HOME}"

  if [[ ! -f "$input" ]]; then
    echo "  ${RED}file not found: $input — skipped${RESET}"
    ((count_skipped++)) || true
    echo
    continue
  fi

  read -r -p "  Source URL: " url
  read -r -p "  Creator handle: " creator
  read -r -p "  Notes (optional, e.g. 'trimmed 0.5s lead-in'): " notes

  echo "  ${DIM}normalising → mono 16kHz 2s 64k MP3...${RESET}"
  if normalise_clip "$input" "$target"; then
    new_size=$(stat -c%s "$target")
    if (( new_size < 1024 )); then
      echo "  ${RED}ffmpeg succeeded but output is tiny ($new_size bytes) — check the input${RESET}"
    else
      echo "  ${GREEN}✓ $target ($new_size bytes)${RESET}"
      update_sources_md "$name" "$url" "$creator" "$notes"
      ((count_done++)) || true
    fi
  else
    echo "  ${RED}ffmpeg failed — skipping${RESET}"
    ((count_skipped++)) || true
  fi
  echo
done

echo "${BOLD}Final state:${RESET}"
for n in "${NAMES[@]}"; do print_status "$n"; done
echo
echo "${GREEN}imported: ${count_done}${RESET}   ${YELLOW}skipped: ${count_skipped}${RESET}"
echo
echo "${DIM}Next steps:${RESET}"
echo "  1. Verify the catalog integrity check still passes:"
echo "       cd kiosk/voice && .venv/bin/pytest homecal_voice/catalog_test.py -v"
echo "  2. Re-run the full Pi suite as a regression check:"
echo "       cd kiosk/voice && .venv/bin/pytest -q"
echo "  3. Listen-test one clip to confirm it plays:"
echo "       ffplay -nodisp -autoexit $CLIPS_DIR/chicken.mp3"
echo "  4. Commit:"
echo "       git add kiosk/voice/homecal_voice/clips/noises/"
echo "       git commit -m \"feat(pi-voice): real CC0 noise clips for catalog\""
echo
