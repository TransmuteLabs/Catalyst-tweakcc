# CONSTRAINT: installation inputs have one ordered home for hashing, delivery and full triggers.
WITNESS_MANIFESTS='pnpm-lock.yaml package.json pnpm-workspace.yaml .npmrc .pnpmfile.cjs'
# CONSTRAINT: literal CONFIG_FILE_NAMES from lint-staged 16.2.7, lib/configFiles.js; package.json is already an installation input.
WITNESS_LINT_CONFIGS='package.json
package.yaml
package.yml
.lintstagedrc
.lintstagedrc.json
.lintstagedrc.yaml
.lintstagedrc.yml
.lintstagedrc.mjs
.lintstagedrc.mts
.lintstagedrc.js
.lintstagedrc.ts
.lintstagedrc.cjs
.lintstagedrc.cts
lint-staged.config.mjs
lint-staged.config.mts
lint-staged.config.js
lint-staged.config.ts
lint-staged.config.cjs
lint-staged.config.cts'
WITNESS_OTHER_TRIGGERS='tsconfig*.json
eslint.config.*
vitest.config.*
.prettierrc*
prettier.config.*
.prettierignore
src/tests/setup/*'
witness_encode() {
  local p="$1"
  p=${p//%/%25}; p=${p//,/%2C}; p=${p//$'\n'/%0A}; p=${p//$'\r'/%0D}; p=${p//$'\t'/%09}
  printf '%s' "$p"
}
witness_decode() {
  local p="$1"
  p=${p//%09/$'\t'}; p=${p//%0D/$'\r'}; p=${p//%0A/$'\n'}; p=${p//%2C/,}; p=${p//%25/%}
  printf '%s' "$p"
}
witness_patterns() {
  local m
  for m in $WITNESS_MANIFESTS; do printf '%s\n' "$m"; done
  while IFS= read -r m; do
    case " $WITNESS_MANIFESTS " in *" $m "*) continue ;; esac
    printf '%s\n' "$m"
  done <<EOF
$WITNESS_LINT_CONFIGS
EOF
  printf '%s\n' "$WITNESS_OTHER_TRIGGERS"
}
witness_path_mode() {
  local st="$1" p="$2" pattern base="${2##*/}"
  case "$st" in
    D|T|R*|C*) case "$p" in src/*) needed=full ;; esac ;;
  esac
  while IFS= read -r pattern; do
    case "$pattern" in
      */*) case "$p" in $pattern) needed=full ;; esac ;;
      *) case "$base" in $pattern) needed=full ;; esac ;;
    esac
  done <<EOF
$(witness_patterns)
EOF
}
witness_validate_new() {
  local f="$1"
  case "$f" in
    *,*|*$'\n'*) fail "ФАЙЛЫ_НЕКАНОНИЧНЫ: запятая или перевод строки в пути: $f" ;;
  esac
}
witness_status_mode() {
  local st old new
  needed=related
  while IFS= read -r -d '' st; do
    IFS= read -r -d '' old || fail 'СТАТУС: нет пути'
    case "$st" in
      R*|C*)
        IFS= read -r -d '' new || fail 'СТАТУС: нет нового пути'
        witness_validate_new "$new"
        witness_path_mode "$st" "$new"
        ;;
      A) witness_validate_new "$old" ;;
      M|D|T) ;;
      *) fail "СТАТУС: неизвестный статус $st" ;;
    esac
    witness_path_mode "$st" "$old"
  done < "$1" || fail 'СТАТУС: список не читается'
}
witness_files() {
  local f encoded
  F=""
  while IFS= read -r -d '' f; do
    encoded=$(witness_encode "$f") || fail 'ФАЙЛЫ: кодировка отказала'
    F="${F:+$F,}$encoded"
  done < "$1" || fail 'ФАЙЛЫ: список не читается'
}
