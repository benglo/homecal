#!/usr/bin/env bash
# Process audio files dropped into kiosk/voice/homecal_voice/clips/noises/_incoming/
# and normalise them into the catalog slots. Updates SOURCES.md inline.
#
# Workflow:
#   1. Download CC0 clips on your laptop from https://pixabay.com/sound-effects/
#      (Freesound CC0 filter as backup).
#   2. FTP/scp them into kiosk/voice/homecal_voice/clips/noises/_incoming/ on
#      this host. Filenames just need to contain the slot word — pixabay's
#      "apebble-fart-4-228244.mp3" matches the fart slot automatically. Any
#      audio extension ffmpeg can read works.
#   3. Run: bash kiosk/voice/scripts/import-noises.sh
#      The script normalises each matched file into <name>.mp3, prompts for
#      provenance (URL + creator), updates SOURCES.md, then removes the source.

set -euo pipefail

# Resolve project paths regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CATALOG="$PROJECT_ROOT/kiosk/voice/homecal_voice/catalogs/noises.json"
CLIPS_DIR="$PROJECT_ROOT/kiosk/voice/homecal_voice/clips/noises"
INCOMING_DIR="$CLIPS_DIR/_incoming"
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

mkdir -p "$INCOMING_DIR"

count_total=${#NAMES[@]}
count_done=0
count_skipped=0
count_missing=0

is_placeholder() {
  # Treat a file as a placeholder if it doesn't exist or is < 1KB.
  local f="$1"
  [[ ! -s "$f" ]] || (( $(stat -c%s "$f") < 1024 ))
}

# Returns 0 if filename $1 contains slot $2 as a whole word (case-insensitive,
# bounded by start/end of string or any non-alphanumeric char). Lets pixabay
# names like "apebble-fart-4-228244.mp3" match the "fart" slot.
filename_matches_slot() {
  local fname_lower="${1,,}"
  local slot="$2"
  [[ "$fname_lower" =~ (^|[^a-z0-9])${slot}([^a-z0-9]|$) ]]
}

# Find a file in _incoming/ whose name contains <slot> as a word (any
# extension). Echoes the path of the first match, or empty string if none.
find_incoming() {
  local name="$1" base
  shopt -s nullglob
  local files=("$INCOMING_DIR"/*)
  shopt -u nullglob
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    if filename_matches_slot "$base" "$name"; then
      echo "$f"
      return
    fi
  done
  echo ""
}

print_status() {
  local name="$1"
  local path="$CLIPS_DIR/${name}.mp3"
  local incoming
  incoming="$(find_incoming "$name")"

  local state_colour state_text
  if is_placeholder "$path"; then
    state_colour="$YELLOW"; state_text="placeholder"
  else
    state_colour="$GREEN"; state_text="real ($(stat -c%s "$path") bytes)"
  fi

  if [[ -n "$incoming" ]]; then
    printf "%s  %s%-12s%s %-22s %s← %s%s\n" \
      "$DIM" "$state_colour" "$name" "$RESET" "$state_text" "$BLUE" "$(basename "$incoming")" "$RESET"
  else
    printf "%s  %s%-12s%s %s\n" "$DIM" "$state_colour" "$name" "$RESET" "$state_text"
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
echo "${DIM}Drop folder: $INCOMING_DIR${RESET}"
echo "${DIM}Target:      $CLIPS_DIR${RESET}"
echo

echo "${BOLD}Current state:${RESET}"
for n in "${NAMES[@]}"; do print_status "$n"; done
echo

# Warn about any incoming files that don't match a catalog slot.
shopt -s nullglob
all_incoming=("$INCOMING_DIR"/*)
shopt -u nullglob
if (( ${#all_incoming[@]} > 0 )); then
  unmatched=()
  for f in "${all_incoming[@]}"; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    matched=0
    for n in "${NAMES[@]}"; do
      if filename_matches_slot "$base" "$n"; then matched=1; break; fi
    done
    (( matched )) || unmatched+=("$base")
  done
  if (( ${#unmatched[@]} > 0 )); then
    echo "${YELLOW}Unmatched files in _incoming/ (rename to include a slot word to import):${RESET}"
    for u in "${unmatched[@]}"; do echo "  ${DIM}- $u${RESET}"; done
    echo
  fi
fi

echo "${BOLD}Processing ${count_total} catalog entries.${RESET}"
echo "${DIM}For each match, you'll be asked for provenance (URL + creator).${RESET}"
echo "${DIM}Type 'q' at any prompt to stop and keep progress so far.${RESET}"
echo

abort=0
for name in "${NAMES[@]}"; do
  (( abort )) && break

  target="$CLIPS_DIR/${name}.mp3"
  source_file="$(find_incoming "$name")"

  if [[ -z "$source_file" ]]; then
    ((count_missing++)) || true
    continue
  fi

  echo "${BLUE}── ${name} ──${RESET}  ${DIM}($(basename "$source_file"))${RESET}"

  if ! is_placeholder "$target"; then
    read -r -p "  Already imported. Replace? [y/N/q] " replace
    case "$replace" in
      q|Q) abort=1; echo "  ${YELLOW}stopping early${RESET}"; echo; break ;;
      y|Y) : ;;
      *) echo "  ${DIM}keeping existing — leaving $(basename "$source_file") in _incoming${RESET}"; echo; continue ;;
    esac
  fi

  read -r -p "  Source URL (or 'q' to stop): " url
  case "$url" in q|Q) abort=1; echo "  ${YELLOW}stopping early${RESET}"; echo; break ;; esac
  read -r -p "  Creator handle: " creator
  read -r -p "  Notes (optional, e.g. 'trimmed 0.5s lead-in'): " notes

  echo "  ${DIM}normalising → mono 16kHz 2s 64k MP3...${RESET}"
  if normalise_clip "$source_file" "$target"; then
    new_size=$(stat -c%s "$target")
    if (( new_size < 1024 )); then
      echo "  ${RED}ffmpeg succeeded but output is tiny ($new_size bytes) — check the input${RESET}"
      ((count_skipped++)) || true
    else
      echo "  ${GREEN}✓ $target ($new_size bytes)${RESET}"
      update_sources_md "$name" "$url" "$creator" "$notes"
      rm -f "$source_file"
      ((count_done++)) || true
    fi
  else
    echo "  ${RED}ffmpeg failed — leaving source in _incoming${RESET}"
    ((count_skipped++)) || true
  fi
  echo
done

echo "${BOLD}Final state:${RESET}"
for n in "${NAMES[@]}"; do print_status "$n"; done
echo
echo "${GREEN}imported: ${count_done}${RESET}   ${YELLOW}skipped: ${count_skipped}${RESET}   ${DIM}no source: ${count_missing}${RESET}"
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
