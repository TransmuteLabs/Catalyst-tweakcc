#!/usr/bin/env bash
# CONSTRAINT: fixtures and stubbed transports stay inside this stand's own directory.
# CONSTRAINT: each named tooth must fail under its own production mutation.
set -u
export LC_ALL=C
EXPECTED_TEETH=127
EXPECTED_TRIGGER_ROWS=30
HERE=$(cd "$(dirname "$0")" && pwd)
PRODUCER="$HERE/run-witness.sh"
DOOR="$HERE/../.husky/pre-commit"
RULES="$HERE/witness-rules.sh"
DEPS=$(cd "$HERE/../node_modules" && pwd -P) || exit 2
REAL_NODE=$(command -v node) || exit 2
SANDBOX="${WITNESS_TEST_SANDBOX:-/var/tmp}"
case "$SANDBOX/" in "$HOME/"*) printf 'stand: sandbox must be outside HOME\n' >&2; exit 2 ;; esac
mkdir -p "$SANDBOX" || exit 2
ROOT=$(mktemp -d "$SANDBOX/producer-teeth.XXXXXX") || exit 2
trap 'rm -rf "$ROOT"' EXIT
POSIX_ON=$(set -o | sed -n 's/^posix[[:space:]]*on$/on/p')
export TEST_SHELL="$BASH" TEST_POSIX="$POSIX_ON" TEST_DEPS="$DEPS" REAL_NODE
PASS=0; FAIL=0; MUT_RED=0; MUT_TOTAL=0; INERT_CONTROLS=0
world() {
  R="$ROOT/$1"; H="$R/home"; BIN="$R/bin"; OUT=""; DOUT=""
  export TEST_TMP="$R/tmp"
  mkdir -p "$R/repo/src" "$R/repo/scripts" "$R/tmp" "$H" "$BIN"
  cp "$SUT" "$R/repo/scripts/run-witness.sh" || { printf 'ERROR copy producer\n' >&2; exit 2; }
  [ ! -f "$SUT_RULES" ] || cp "$SUT_RULES" "$R/repo/scripts/witness-rules.sh"
  cp "$DOOR" "$R/repo/door"
  printf '{"name":"fixture","version":"1.0.0","lint-staged":{"*.{ts,tsx}":"prettier --write","*.{json,md}":"prettier --write"}}\n' > "$R/repo/package.json"
  "$REAL_NODE" -e 'const fs=require("node:fs");const f=process.argv[1];fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f)),null,2)+"\n")' "$R/repo/package.json"
  printf 'lockfileVersion: 9\n' > "$R/repo/pnpm-lock.yaml"
  printf 'export const a = 1;\n' > "$R/repo/src/a.ts"
  git -C "$R/repo" init -q
  git -C "$R/repo" config user.email fixture@localhost
  git -C "$R/repo" config user.name Fixture
  git -C "$R/repo" -c core.hooksPath=/dev/null add package.json pnpm-lock.yaml src
  git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm base
  cat > "$BIN/ssh" <<'SSH'
#!/usr/bin/env bash
printf '%q ' "$@" >> "$TEST_HOME/ssh-calls"; printf '\n' >> "$TEST_HOME/ssh-calls"
shift
if [ "$1" = bash ]; then
  shift
  "$TEST_SHELL" ${TEST_POSIX:+--posix} "$@"
else
  "$TEST_SHELL" ${TEST_POSIX:+--posix} -c "$*"
fi
SSH
  cat > "$BIN/rsync" <<'RSYNC'
#!/usr/bin/env bash
while [ $# -gt 2 ]; do shift; done
src="$1"; dst="$2"; dst="$HOME/${dst#*:}"
mkdir -p "$dst" || exit 23
cp -a "$src/." "$dst/" || exit 23
if [ "${PROBE:-}" = remote-escape ]; then
  mkdir -p "$dst/e" "$(dirname "$dst")/outside"
  printf external > "$(dirname "$dst")/outside/x"
  ln -s .. "$dst/e/up"
  ln -s e/up/../outside/x "$dst/escape"
fi
RSYNC
  cat > "$BIN/systemd-run" <<'SCOPE'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do
  case "$1" in --user|--scope|--quiet) shift ;; -p) shift 2 ;; *) break ;; esac
done
exec "$@"
SCOPE
  cat > "$BIN/pnpm" <<'PNPM'
#!/usr/bin/env bash
printf '%q ' "$@" >> "$TEST_HOME/pnpm-calls"; printf '\n' >> "$TEST_HOME/pnpm-calls"
case "$1" in
  install) ln -s "$TEST_DEPS" node_modules; exit $? ;;
  exec)
    shift
    case "$1" in
      tsc)
        if [ "${PROBE:-}" = hold ] || [ "${PROBE:-}" = compete ]; then
          exec /usr/bin/perl -e '
            use Fcntl qw(:flock);
            my $h = $ENV{TEST_HOME};
            if ($ENV{PROBE} eq "compete") {
              open(my $g, ">>", "$h/counter.lock") or die $!;
              flock($g, LOCK_EX) or die $!;
              my $active = mkdir("$h/in-checks");
              open(my $events, ">>", "$h/events") or die $!;
              print $events ($active ? "ENTER\n" : "OVERLAP\n");
              close($events) or die $!;
            }
            open(my $ready, ">", "$h/ready") or die $!;
            print $ready "$$\n"; close($ready) or die $!;
            while (!-e "$h/release") { select(undef, undef, undef, 0.02); }
            rmdir("$h/in-checks") if $ENV{PROBE} eq "compete";
          '
        fi
        if [ "${PROBE:-}" = inherit ]; then
          /usr/bin/perl -e '
            open(my $f, ">&=", 9) or die "inherited fd 9 missing";
            open(my $ready, ">", "$ENV{TEST_HOME}/child-ready") or die $!;
            print $ready "$$\n"; close($ready) or die $!;
            while (!-e "$ENV{TEST_HOME}/child-release") { select(undef, undef, undef, 0.02); }
            close($f) or die $!;
            open(my $done, ">", "$ENV{TEST_HOME}/child-done") or die $!;
            print $done "done\n"; close($done) or die $!;
          ' > "$TEST_HOME/child-output" 2>&1 &
          n=0
          while [ ! -s "$TEST_HOME/child-ready" ]; do
            n=$((n+1)); [ "$n" -lt 200 ] || exit 23; /usr/bin/sleep 0.02
          done
        fi
        [ "${PROBE:-}" != red ] || exit 23
        exit 0 ;;
      prettier)
        shift
        if [ "${PROBE:-}" = bad-js ] || [ "${PROBE:-}" = glob ]; then
          exec "$REAL_NODE" "$TEST_DEPS/prettier/bin/prettier.cjs" "$@"
        fi
        exit 0 ;;
      *) exit 0 ;;
    esac ;;
esac
exit 2
PNPM
  cat > "$BIN/find" <<'FIND'
#!/usr/bin/env bash
case "${PROBE:-}:$1" in remote-find:*scratch/tweakcc-witness/*) printf 'REMOTE_FIND_RC=23\n' >&2; exit 23 ;; esac
exec /usr/bin/find "$@"
FIND
  cat > "$BIN/rm" <<'RM'
#!/usr/bin/env bash
if [ "${PROBE:-}" = cleanup ]; then
  for p in "$@"; do
    case "$p" in "$TEST_TMP"/tweakcc-witness.*|"$TEST_TMP"/tweakcc-door-files.*) printf 'LOCAL_RM_RC=23 %s\n' "$p" >&2; exit 23 ;; esac
  done
fi
exec /usr/bin/rm "$@"
RM
  chmod +x "$BIN/"*
  : > "$H/ssh-calls"; : > "$H/pnpm-calls"
  printf 'export const a = 2;\n' > "$R/repo/src/a.ts"
  git -C "$R/repo" add src/a.ts
  T=$(git -C "$R/repo" write-tree)
}
produce() {
  local index
  index=$(git -C "$R/repo" rev-parse --git-path index)
  case "$index" in /*) ;; *) index="$R/repo/$index" ;; esac
  cp "$index" "$R/oracle-index" || { printf 'ERROR oracle-index producer\n' >&2; exit 2; }
  T=$(GIT_INDEX_FILE="$R/oracle-index" git -C "$R/repo" write-tree) || { printf 'ERROR oracle-index producer\n' >&2; exit 2; }
  /usr/bin/rm -f "$R/oracle-index"
  WIT="$R/repo/.git/tweakcc-witness/$T"
  (cd "$R/repo" && env HOME="$H" TMPDIR="$R/tmp" PATH="$BIN:$PATH" TEST_HOME="$H" PROBE="${PROBE:-}" "$BASH" ${POSIX_ON:+--posix} scripts/run-witness.sh "$@") > "$R/output" 2>&1
  RC=$?; OUT=$(cat "$R/output")
  [ "$RC" = 127 ] || PRODUCER_EXECUTED=1
}
door() {
  (cd "$R/repo" && env HOME="$H" TMPDIR="$R/tmp" PATH="$BIN:$PATH" TEST_HOME="$H" PROBE="${PROBE:-}" "$BASH" ${POSIX_ON:+--posix} door) > "$R/door-output" 2>&1
  DRC=$?; DOUT=$(cat "$R/door-output")
}
mode_full() { [ "$RC" = 0 ] && grep -qx 'mode=full' "$WIT" && door && [ "$DRC" = 0 ]; }
case_local_escape() {
  world "$1"; mkdir -p "$R/repo/e"; ln -s .. "$R/repo/e/up"; ln -s e/up/../outside/x "$R/repo/escape"
  git -C "$R/repo" add e escape; produce
  [ "$RC" = 2 ] && grep -Eq 'SYMLINK_ESCAPE: [^[:space:]]*/escape$' "$R/output" && ! grep -F 'e/up' "$R/output" && [ ! -s "$H/ssh-calls" ] && [ ! -e "$WIT" ]
}
case_remote_escape() {
  world "$1"; PROBE=remote-escape; produce
  [ "$RC" = 2 ] && grep -Eq 'SYMLINK_ESCAPE: [^[:space:]]*/escape$' "$R/output" && ! grep -F 'e/up' "$R/output" && [ ! -e "$WIT" ]
}
case_root_link() {
  world "$1"; mkdir -p "$R/repo/e"; ln -s .. "$R/repo/e/up"
  git -C "$R/repo" add e; produce
  [ "$RC" = 0 ] && [ -f "$WIT" ] && grep -Fqx 'run-witness: симлинки снимка внутри корня' "$WIT.log"
}
utf8_world() {
  world "$1"
  printf 'export const odd = 1;\n' > "$R/repo/src/"$'\xff'".ts"
  git -C "$R/repo" add src
  git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm byte-name
}
case_utf8() {
  utf8_world "$1"; printf '{}\n' > "$R/repo/.prettierrc"; git -C "$R/repo" add .prettierrc; produce
  [ "$RC" = 2 ] && [[ "$OUT" == *'ФАЙЛЫ_НЕ_UTF8: src/%FF.ts'* ]] && [ ! -e "$WIT" ]
}
case_utf8_delete() {
  utf8_world "$1"; /usr/bin/rm "$R/repo/src/"$'\xff'".ts"; git -C "$R/repo" add -A; produce; mode_full
}
case_utf8_related() {
  utf8_world "$1"; printf 'export const odd = 2;\n' > "$R/repo/src/"$'\xff'".ts"; git -C "$R/repo" add src; produce
  [ "$RC" = 2 ] && [[ "$OUT" == *'ФАЙЛЫ_НЕ_UTF8: src/%FF.ts'* ]] && [ ! -e "$WIT" ]
}
case_alias() {
  world "$1"; mkdir -p "$R/root"; ln -s "$R/root" "$R/alias"; printf x > "$R/root/x"; ln -s "$R/alias/x" "$R/root/link"
  local functions
  functions=$(sed -n '/^normalize_lex()/,/^# --- снимок/p; /^physical_path()/,/^# --- снимок/p' "$SUT" | sed '/^# --- снимок/d')
  eval "$functions"
  resolve_under_root "$R/root" "$R/root/link"
}
case_busy() {
  world "$1"; start_holder
  wait_file "$H/ready" || { printf release > "$H/release"; wait "$HPID"; return 1; }
  local lock="$R/repo/.git/tweakcc-witness/$T.lock" inode result=0 first second
  inode=$(lock_inode "$lock")
  PROBE=red; produce; second="$RC"
  [ "$second" = 8 ] && [[ "$OUT" == *ЗАМОК_ЗАНЯТ* ]] && [[ "$OUT" == *owner=* ]] && kill -0 "$HPID" && [ "$(lock_inode "$lock")" = "$inode" ] || result=1
  printf release > "$H/release"; wait "$HPID"; first=$?
  [ "$first" = 0 ] && [ -f "$WIT" ] && door && [ "$DRC" = 0 ] || result=1
  printf 'busy: holder=%s follower=%s same inode result=%s\n' "$first" "$second" "$result"
  return "$result"
}
case_dead_lock() {
  world "$1"; start_holder
  if ! wait_file "$H/ready"; then
    printf release > "$H/release"; wait "$HPID"
    printf 'FAIL dead_lock setup: держатель не записал ready (holder=%s)\n' "$HPID"
    return 2
  fi
  local child lock; child=$(cat "$H/ready"); lock="$R/repo/.git/tweakcc-witness/$T.lock"
  # CONSTRAINT: rc 2 is a fixture refusal, never a measured mutation's red result.
  if ! kill -0 "$HPID" || ! grep -q '^pid=' "$lock"; then
    printf release > "$H/release"; wait "$HPID"
    printf 'FAIL dead_lock setup: держатель без строки владельца (holder=%s lock=%s)\n' "$HPID" "$lock"
    return 2
  fi
  kill -KILL "$child" "$HPID"; wait "$HPID"
  produce
  [ "$RC" = 0 ] && [ -f "$WIT" ] && [ -f "$R/repo/.git/tweakcc-witness/$T.lock" ] && [[ "$OUT" != *мёртвый* ]]
}
case_producer_index_lock() {
  world "$1"; printf keep > "$R/repo/.git/index.lock"; produce
  [ "$RC" = 0 ] && [ "$(cat "$R/repo/.git/index.lock")" = keep ]
}
case_door_index_lock() {
  world "$1"; produce; [ "$RC" = 0 ] || return 1
  printf keep > "$R/repo/.git/index.lock"; door
  [ "$DRC" = 0 ] && [ "$(cat "$R/repo/.git/index.lock")" = keep ]
}
case_alternate_index() {
  world "$1"; cp "$R/repo/.git/index" "$R/alternate-index"
  git -C "$R/repo" reset -q HEAD
  local want
  want=$(GIT_INDEX_FILE="$R/alternate-index" git -C "$R/repo" write-tree)
  printf keep > "$R/alternate-index.lock"
  export GIT_INDEX_FILE="$R/alternate-index"
  produce; door
  unset GIT_INDEX_FILE
  [ "$RC" = 0 ] && [ "$DRC" = 0 ] && [[ "$DOUT" == *"$want"* ]] && [ -f "$R/repo/.git/tweakcc-witness/$want" ] && [ "$(cat "$R/alternate-index.lock")" = keep ]
}
case_producer_cleanup() {
  world "$1"; PROBE=cleanup; produce
  [ "$RC" = 6 ] && [[ "$OUT" == *LOCAL_RM_RC=23* ]] && [ ! -e "$WIT" ]
}
case_door_cleanup() {
  world "$1"; produce; [ "$RC" = 0 ] || return 1
  PROBE=cleanup; door
  [ "$DRC" != 0 ] && [[ "$DOUT" == *LOCAL_RM_RC=23* ]]
}
case_unicode_delete() {
  world "$1"; printf x > "$R/repo/src/ёж.ts"; git -C "$R/repo" add src/ёж.ts; git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm unicode
  /usr/bin/rm "$R/repo/src/ёж.ts"; git -C "$R/repo" add -A; produce; mode_full
}
case_unicode_setup() {
  world "$1"; mkdir -p "$R/repo/src/tests/setup"; printf x > "$R/repo/src/tests/setup/ёж.ts"; git -C "$R/repo" add -A; produce; mode_full
}
case_unicode_rename() {
  world "$1"; printf 'export const a = 1;\n' > "$R/repo/src/a.ts"; git -C "$R/repo" add src/a.ts
  git -C "$R/repo" mv src/a.ts src/ёж.ts; produce; mode_full
}
case_recipe_rename() {
  world "$1"; mkdir -p "$R/repo/docs"; printf x > "$R/repo/docs/x.md"; git -C "$R/repo" add docs; git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm docs
  git -C "$R/repo" mv docs/x.md src/y.ts; door
  local cmd="${DOUT#*произвести: }"
  (cd "$R/repo/src" && env HOME="$H" TMPDIR="$R/tmp" PATH="$BIN:$PATH" TEST_HOME="$H" "$BASH" ${POSIX_ON:+--posix} -c "$cmd") > "$R/recipe-output" 2>&1
  RC=$?; T=$(git -C "$R/repo" write-tree); WIT="$R/repo/.git/tweakcc-witness/$T"; mode_full
}
case_config_rename() {
  world "$1"; git -C "$R/repo" mv package.json fmt-old.json; git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm old
  git -C "$R/repo" mv fmt-old.json package.json; produce; mode_full
}
case_newline() {
  world "$1"; printf 'export const odd = 1;\n' > "$R/repo/src/we"$'\n'"ird.ts"; git -C "$R/repo" add src; git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm odd
  printf '# unrelated\n' > "$R/repo/other.md"; git -C "$R/repo" add other.md; produce; door
  [ "$RC" = 0 ] && [ "$DRC" = 0 ] || return 1
  /usr/bin/rm "$R/repo/src/we"$'\n'"ird.ts"; git -C "$R/repo" add -A; produce; mode_full
}
case_manifest() {
  world "$1"; mkdir -p "$R/repo/cfg"; printf 'registry=https://example.invalid/witness/\n' > "$R/repo/cfg/settings"; ln -s cfg/settings "$R/repo/.npmrc"; git -C "$R/repo" add .npmrc cfg; produce
  local npmrc
  npmrc=$(find "$H/scratch/tweakcc-deps" -name .npmrc)
  [ "$RC" = 0 ] && [ -f "$npmrc" ] && [ ! -L "$npmrc" ] && [ "$(cat "$npmrc")" = 'registry=https://example.invalid/witness/' ] || return 1
  [ "$(pnpm --dir "${npmrc%/.npmrc}" config get registry)" = 'https://example.invalid/witness/' ]
}
case_remote_find() {
  world "$1"; PROBE=remote-find; produce
  [ "$RC" != 0 ] && [[ "$OUT" == *find* ]] && [ ! -e "$WIT" ]
}
case_host() {
  world "$1"; export TWEAKCC_WITNESS_HOST=-Ffoo; produce; unset TWEAKCC_WITNESS_HOST
  [ "$RC" = 2 ] && [[ "$OUT" == *ХОСТ* ]] && [ ! -s "$H/ssh-calls" ]
}
case_glob() {
  world "$1"; printf '{"name":"fixture","version":"1.0.0","lint-staged":{"*.{ts,tsx}":"prettier --write","*.{json,md}":"prettier --write","*.css":"prettier --write"}}\n' > "$R/repo/package.json"
  "$REAL_NODE" -e 'const fs=require("node:fs");const f=process.argv[1];fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f)),null,2)+"\n")' "$R/repo/package.json"
  printf 'a{color:red}\n' > "$R/repo/outside.css"; git -C "$R/repo" add package.json outside.css; PROBE=glob; produce
  [ "$RC" = 4 ] && [[ "$OUT" == *outside.css* ]] && [ ! -e "$WIT" ]
}
case_bad_js() {
  world "$1"; printf 'let x={a:1}\n' > "$R/repo/src/bad.js"; printf '{}\n' > "$R/repo/.prettierrc"; git -C "$R/repo" add src/bad.js .prettierrc; PROBE=bad-js; produce
  [ "$RC" = 4 ] && [[ "$OUT" == *src/bad.js* ]] && [ ! -e "$WIT" ]
}

case_dash() {
  world "$1"; printf '{"x":1}\n' > "$R/repo/-odd.json"; git -C "$R/repo" add -- -odd.json
  if [ "$2" = full ]; then printf '{}\n' > "$R/repo/.prettierrc"; git -C "$R/repo" add .prettierrc; fi
  PROBE=bad-js; produce
  [ "$RC" = 4 ] && [[ "$OUT" == *'prettier rc=1'* ]] && [ ! -e "$WIT" ] || return 1
  printf 'DASH_BAD_RC=%s\n%s\n' "$RC" "$OUT"
  printf '{\n  "x": 1\n}\n' > "$R/repo/-odd.json"; git -C "$R/repo" add -- -odd.json; produce; door
  [ "$RC" = 0 ] && [ "$DRC" = 0 ]
}
case_dash_related() { case_dash "$1" related; }
case_dash_full() { case_dash "$1" full; }
wait_file() {
  local n=0
  while [ ! -s "$1" ]; do
    n=$((n+1)); [ "$n" -lt 250 ] || return 1; /usr/bin/sleep 0.02
  done
}
lock_inode() { /usr/bin/perl -e 'my @s=stat($ARGV[0]); @s or exit 2; print "$s[0]:$s[1]";' "$1"; }
lock_free() { /usr/bin/perl -e 'use Fcntl qw(:flock); open(my $f, ">>", $ARGV[0]) or exit 2; flock($f, LOCK_EX|LOCK_NB) or exit 1;' "$1"; }
start_holder() {
  (cd "$R/repo" && exec env HOME="$H" TMPDIR="$R/tmp" PATH="$BIN:$PATH" TEST_HOME="$H" PROBE="${1:-hold}" "$BASH" ${POSIX_ON:+--posix} scripts/run-witness.sh) > "$R/holder-output" 2>&1 &
  HPID=$!
}
case_lock_inode_retry() {
  world "$1"; local lock="$R/repo/.git/tweakcc-witness/$T.lock" result=0
  mkdir -p "${lock%/*}"; : > "$lock"
  cat > "$R/replace-lock" <<'REPLACE_LOCK'
printf attempt >> "$TEST_HOME/attempts"
if [ ! -e "$TEST_HOME/replaced" ]; then
  mv "$1" "$1.old" || exit 23
  : > "$1"; printf done > "$TEST_HOME/replaced"
fi
REPLACE_LOCK
  export TWEAKCC_WITNESS_LOCK_TEST_HOOK="$R/replace-lock"; produce
  unset TWEAKCC_WITNESS_LOCK_TEST_HOOK
  [ "$RC" = 0 ] && [ -f "$lock" ] && [ "$(cat "$H/attempts")" = attemptattempt ] && lock_free "$lock.old" || result=1
  printf 'lock_inode_retry: rc=%s attempts=%s result=%s\n' "$RC" "$(cat "$H/attempts" 2>&1)" "$result"
  return "$result"
}
case_lock_retry_limit() {
  world "$1"
  cat > "$R/replace-always" <<'REPLACE_ALWAYS'
printf x >> "$TEST_HOME/attempts"
mv "$1" "$1.old" || exit 23
: > "$1"
REPLACE_ALWAYS
  export TWEAKCC_WITNESS_LOCK_TEST_HOOK="$R/replace-always"; produce
  unset TWEAKCC_WITNESS_LOCK_TEST_HOOK
  [ "$RC" = 8 ] && [[ "$OUT" == *ЗАМОК_ГОНКА* ]] && [ "$(cat "$H/attempts")" = xxxxxxxx ]
}
case_lock_persistent() {
  world "$1"; local lock="$R/repo/.git/tweakcc-witness/$T.lock" inode result=0
  produce
  [ "$RC" = 0 ] && [ -f "$lock" ] && lock_free "$lock" || result=1
  inode=$(lock_inode "$lock")
  PROBE=red; produce
  [ "$RC" = 4 ] && [ -f "$lock" ] && [ "$(lock_inode "$lock")" = "$inode" ] && lock_free "$lock" || result=1
  PROBE=""; produce
  [ "$RC" = 0 ] && [ "$(lock_inode "$lock")" = "$inode" ] || result=1
  printf 'lock_persistent: same inode after success/refusal/retry result=%s\n' "$result"
  return "$result"
}
case_lock_directory() {
  world "$1"; local lock="$R/repo/.git/tweakcc-witness/$T.lock" cmd
  mkdir -p "$lock"; printf keep > "$lock/owner"; produce
  cmd=$(printf 'cd %q && rm -rf -- %q' "$R/repo" ".git/tweakcc-witness/$T.lock")
  [ "$RC" = 8 ] && [[ "$OUT" == *ЗАМОК_НЕЧИТАЕМ* ]] && [[ "$OUT" == *"$cmd"* ]] && [ "$(cat "$lock/owner")" = keep ]
}
case_lock_perl_error() {
  world "$1"; printf '#!%s\nexit 2\n' "$BASH" > "$BIN/perl"; chmod +x "$BIN/perl"; produce
  [ "$RC" = 2 ] && [[ "$OUT" == *'ПРИБОР_НЕДОСТУПЕН: flock'* ]] && [ ! -e "$WIT" ]
}
case_lock_inherited() {
  world "$1"; PROBE=inherit; produce
  local result=0 first="$RC" lock="$R/repo/.git/tweakcc-witness/$T.lock" child="" inode
  if [ "$first" != 0 ] || ! wait_file "$H/child-ready"; then printf release > "$H/child-release"; return 1; fi
  child=$(cat "$H/child-ready"); inode=$(lock_inode "$lock")
  PROBE=""; produce
  [ "$RC" = 8 ] && [[ "$OUT" == *ЗАМОК_ЗАНЯТ* ]] && kill -0 "$child" && [ "$(lock_inode "$lock")" = "$inode" ] || result=1
  printf 'lock_inherited: child=%s follower=%s inode=%s result=%s\n' "$child" "$RC" "$inode" "$result"
  printf release > "$H/child-release"; wait_file "$H/child-done" || result=1
  produce; [ "$RC" = 0 ] && lock_free "$lock" || result=1
  return "$result"
}
case_lock_age_cleanup() {
  world "$1"; PROBE=inherit; produce
  local result=0 held="$R/repo/.git/tweakcc-witness/$T.lock" d="${R}/repo/.git/tweakcc-witness" child=""
  if [ "$RC" != 0 ] || ! wait_file "$H/child-ready"; then printf release > "$H/child-release"; return 1; fi
  child=$(cat "$H/child-ready")
  : > "$d/free.lock"; printf old > "$d/old-witness"; printf old > "$d/old.log"
  touch -d '40 days ago' "$held" "$d/free.lock" "$d/old-witness" "$d/old.log"
  printf 'export const a = 3;\n' > "$R/repo/src/a.ts"; git -C "$R/repo" add src/a.ts
  PROBE=""; produce
  [ "$RC" = 0 ] && [ -f "$held" ] && kill -0 "$child" && [ ! -e "$d/free.lock" ] && [ ! -e "$d/old-witness" ] && [ ! -e "$d/old.log" ] || result=1
  printf release > "$H/child-release"; wait_file "$H/child-done" || result=1
  printf 'lock_age_cleanup: held stays, free/witness/log removed result=%s\n' "$result"
  return "$result"
}
cleanup_program() {
  "$REAL_NODE" - "$SUT" "$1" <<'CLEANUP_PROGRAM'
const fs = require('node:fs');
const code = fs.readFileSync(process.argv[2], 'utf8');
const start = code.indexOf("perl -e '\nuse Fcntl qw(:flock);\nopendir");
const end = code.indexOf("\n' \"$GITDIR/tweakcc-witness\"", start);
if (start < 0 || end < 0) { console.error('ERROR extract cleanup'); process.exit(2); }
fs.writeFileSync(process.argv[3], code.slice(start + "perl -e '\n".length, end) + '\n');
CLEANUP_PROGRAM
  [ "$?" = 0 ] || exit 2
}
cleanup_order() {
  /usr/bin/perl -e 'opendir(my $d, $ARGV[0]) or die $!; my @n = readdir($d); closedir($d) or die $!; print "$_\n" for grep { /[.]lock$/ } @n;' "$1"
}
case_lock_age_cleanup_continue() {
  local placement d result=0 stuck name n order after
  for placement in first late; do
    world "$1-$placement"; d="$R/repo/.git/tweakcc-witness"; mkdir -p "$d"
    n=0; after=""
    while [ "$n" -lt 64 ]; do
      n=$((n+1)); : > "$d/free-$n.lock"
      order=$(cleanup_order "$d") || return 2
      stuck=""; after=""
      while IFS= read -r name; do
        if [ -z "$stuck" ]; then stuck="$name"; else
          after="$after $name"
          if [ "$placement" = late ]; then stuck="$name"; after=""; fi
        fi
      done <<ORDER
$order
ORDER
      if [ "$placement" = late ]; then
        stuck=$(printf '%s\n' "$order" | /usr/bin/perl -e 'my @n=<STDIN>; print $n[-2] if @n > 1;')
        after=""; local seen=0
        while IFS= read -r name; do
          if [ "$seen" = 1 ]; then after="$after $name"; fi
          [ "$name" != "$stuck" ] || seen=1
        done <<ORDER
$order
ORDER
      fi
      if [ -n "$after" ] && [ "$n" -ge 3 ]; then break; fi
    done
    if [ -z "$after" ]; then printf 'ОТКАЗ ПРИБОРА: readdir has no free successor\n'; return 2; fi
    touch -d '40 days ago' "$d/"*.lock; chmod 000 "$d/$stuck"
    produce
    [ "$RC" = 0 ] && [ -e "$d/$stuck" ] && grep -Fq "уборка замка $stuck:" "$R/output" || result=1
    for name in $after; do [ ! -e "$d/$name" ] || result=1; done
    chmod 644 "$d/$stuck"
    printf 'lock_age_cleanup_continue order=%s failed=%s successors=%s result=%s\n' "$placement" "$stuck" "$after" "$result"
  done
  return "$result"
}
case_lock_age_continue_exit() { case_lock_age_cleanup_continue "$1"; }
case_cleanup_fault() {
  local key="$2" expect="$3" step="$4" d result=0 order target name
  world "$1"; d="$R/cleanup"; mkdir -p "$d"
  for name in old.lock free-1.lock free-2.lock; do : > "$d/$name"; done
  touch -d '40 days ago' "$d/"*.lock
  order=$(cleanup_order "$d") || return 2
  target=$(printf '%s\n' "$order" | /usr/bin/perl -e 'my $n=<STDIN>; print $n;')
  step="${step/old.lock/$target}"
  cleanup_program "$R/cleanup.pl"
  cat > "$R/fault.pl" <<'CLEANUP_FAULT'
use Errno qw(EIO ENOENT EWOULDBLOCK);
our ($path_calls, $closed, $active) = (0, 0, 0);
BEGIN {
  *CORE::GLOBAL::stat = sub (*) {
    my $arg = $_[0]; my $key = $ENV{CLEANUP_FAULT};
    if (!ref($arg)) {
      $active = $arg eq "$ARGV[0]/$ENV{CLEANUP_NAME}";
      return CORE::stat($arg) unless $active;
      $path_calls++;
      if (($key eq "path_stat" || $key eq "close_path_missing") && $path_calls == 2) {
        $! = $key eq "path_stat" ? EIO : ENOENT; return ();
      }
      my @s = CORE::stat($arg);
      $s[1]++ if $key eq "close_inode" && $path_calls == 2 && @s;
      return @s;
    }
    if ($active && ($key eq "fd_stat" || $key eq "close_fd")) { $! = EIO; return (); }
    return CORE::stat($arg);
  };
  *CORE::GLOBAL::flock = sub (*$) {
    if ($active && $ENV{CLEANUP_FAULT} eq "close_busy") { $! = EWOULDBLOCK; return 0; }
    if ($active && $ENV{CLEANUP_FAULT} eq "close_flock") { $! = EIO; return 0; }
    return CORE::flock($_[0], $_[1]);
  };
  *CORE::GLOBAL::unlink = sub (@) {
    if ($active && $ENV{CLEANUP_FAULT} eq "close_unlink") { $! = EIO; return 0; }
    return CORE::unlink(@_);
  };
  *CORE::GLOBAL::close = sub (*) {
    if ($active) { $closed++; print STDERR "FAULT_CLOSE=$closed\n"; }
    my $ok = CORE::close($_[0]);
    if ($active && $ENV{CLEANUP_FAULT} =~ /^close_/) { $! = EIO; return 0; }
    return $ok;
  };
  *CORE::GLOBAL::closedir = sub (*) {
    my $ok = CORE::closedir($_[0]);
    if ($ENV{CLEANUP_FAULT} eq "closedir") { $! = EIO; return 0; }
    return $ok;
  };
}
CLEANUP_FAULT
  cat "$R/cleanup.pl" >> "$R/fault.pl"
  case "$key" in age_stat) chmod 0400 "$d" ;; opendir) d="$R/absent" ;; esac
  env CLEANUP_FAULT="$key" CLEANUP_NAME="$target" /usr/bin/perl "$R/fault.pl" "$d" > "$R/output" 2>&1
  RC=$?; OUT=$(cat "$R/output"); PRODUCER_EXECUTED=1
  [ "$RC" = "$expect" ] && grep -Fq "$step" "$R/output" || result=1
  if [ "$key" = age_stat ]; then chmod 0700 "$d"; fi
  case "$key" in
    age_stat)
      [[ "$OUT" == *'Permission denied'* ]] || result=1
      while IFS= read -r name; do grep -Fq "$name: состояние пути:" "$R/output" || result=1; done <<ORDER
$order
ORDER
      ;;
    opendir) [[ "$OUT" == *"$d"* ]] && [[ "$OUT" == *'No such file or directory'* ]] || result=1 ;;
    closedir) [[ "$OUT" == *"$d"* ]] && [[ "$OUT" == *'Input/output error'* ]] || result=1 ;;
    *)
      [[ "$OUT" == *'Input/output error'* ]] && [ "$(grep -c '^FAULT_CLOSE=' "$R/output")" = 1 ] || result=1
      while IFS= read -r name; do [ "$name" = "$target" ] || [ ! -e "$d/$name" ] || result=1; done <<ORDER
$order
ORDER
      ;;
  esac
  printf 'cleanup_fault %s rc=%s target=%s result=%s\n%s\n' "$key" "$RC" "$target" "$result" "$OUT"
  return "$result"
}
case_cleanup_age_stat() { case_cleanup_fault "$1" age_stat 2 'old.lock: состояние пути:'; }
case_cleanup_path_stat() { case_cleanup_fault "$1" path_stat 2 'old.lock: состояние пути после открытия:'; }
case_cleanup_fd_stat() { case_cleanup_fault "$1" fd_stat 2 'old.lock: состояние fd:'; }
case_cleanup_close_busy() { case_cleanup_fault "$1" close_busy 2 'old.lock: закрытие:'; }
case_cleanup_close_flock() { case_cleanup_fault "$1" close_flock 2 'old.lock: закрытие:'; }
case_cleanup_close_fd() { case_cleanup_fault "$1" close_fd 2 'old.lock: закрытие:'; }
case_cleanup_close_path_missing() { case_cleanup_fault "$1" close_path_missing 2 'old.lock: закрытие:'; }
case_cleanup_close_inode() { case_cleanup_fault "$1" close_inode 2 'old.lock: закрытие:'; }
case_cleanup_close_final() { case_cleanup_fault "$1" close_final 2 'old.lock: закрытие:'; }
case_cleanup_close_unlink() { case_cleanup_fault "$1" close_unlink 2 'old.lock: закрытие:'; }
case_cleanup_opendir() { case_cleanup_fault "$1" opendir 2 'открытие каталога:'; }
case_cleanup_closedir() { case_cleanup_fault "$1" closedir 2 'закрытие каталога:'; }
case_lock_age_race() {
  world "$1"; local lock="$R/repo/.git/tweakcc-witness/$T.lock" old result=0
  mkdir -p "${lock%/*}"; : > "$lock"; touch -d '40 days ago' "$lock"; old=$(lock_inode "$lock")
  cat > "$R/cleanup-race" <<'CLEANUP_RACE'
printf x >> "$TEST_HOME/race-attempts"
if [ ! -e "$TEST_HOME/race-once" ]; then
  printf once > "$TEST_HOME/race-once"
  (unset TWEAKCC_WITNESS_LOCK_TEST_HOOK
   "$TEST_SHELL" ${TEST_POSIX:+--posix} scripts/run-witness.sh --tree "$(git rev-parse 'HEAD^{tree}')" --files src/a.ts) > "$TEST_HOME/age-run" 2>&1 || exit 23
fi
CLEANUP_RACE
  export TWEAKCC_WITNESS_LOCK_TEST_HOOK="$R/cleanup-race"; produce
  unset TWEAKCC_WITNESS_LOCK_TEST_HOOK
  [ "$RC" = 0 ] && [ "$(cat "$H/race-attempts")" = xx ] && [ "$(lock_inode "$lock")" != "$old" ] || result=1
  printf 'lock_age_race: retry on current inode result=%s\n' "$result"
  return "$result"
}
case_lock_three() {
  local iteration result=0 a b c ar br cr
  PRODUCER_EXECUTED=1
  for iteration in $(seq 1 20); do
    world "$1-$iteration"
    cat > "$R/pause-B" <<'PAUSE_B'
if [ ! -e "$TEST_HOME/b-open" ]; then
  printf ready > "$TEST_HOME/b-open"
  n=0; while [ ! -e "$TEST_HOME/b-go" ]; do n=$((n+1)); [ "$n" -lt 250 ] || exit 23; /usr/bin/sleep 0.02; done
fi
PAUSE_B
    (cd "$R/repo"; env HOME="$H" TMPDIR="$R/tmp" PATH="$BIN:$PATH" TEST_HOME="$H" PROBE=compete TWEAKCC_WITNESS_LOCK_TEST_HOOK="$R/pause-B" "$BASH" ${POSIX_ON:+--posix} scripts/run-witness.sh; printf '%s\n' "$?" > "$H/b-rc") > "$R/b-output" 2>&1 & b=$!
    if ! wait_file "$H/b-open"; then printf go > "$H/b-go"; printf release > "$H/release"; wait "$b"; return 1; fi
    start_holder compete; a="$HPID"
    if ! wait_file "$H/ready"; then printf go > "$H/b-go"; printf release > "$H/release"; wait "$a"; wait "$b"; return 1; fi
    # CONSTRAINT: A's tsc is held while B resumes on its pre-opened inode and C competes for the path.
    printf go > "$H/b-go"
    (cd "$R/repo"; env HOME="$H" TMPDIR="$R/tmp" PATH="$BIN:$PATH" TEST_HOME="$H" PROBE=compete "$BASH" ${POSIX_ON:+--posix} scripts/run-witness.sh; printf '%s\n' "$?" > "$H/c-rc") > "$R/c-output" 2>&1 & c=$!
    wait_file "$H/b-rc" || result=1; wait_file "$H/c-rc" || result=1
    printf release > "$H/release"; wait "$a"; ar=$?; wait "$b"; wait "$c"
    br=$(cat "$H/b-rc"); cr=$(cat "$H/c-rc")
    [ "$ar" = 0 ] && [ "$br" = 8 ] && [ "$cr" = 8 ] && [ "$(cat "$H/events")" = ENTER ] || result=1
    printf 'lock_three iteration=%s A=%s B=%s C=%s overlap-result=%s\n' "$iteration" "$ar" "$br" "$cr" "$result"
    [ "$result" = 0 ] || return 1
  done
}
case_release_after_unpublish() {
  world "$1"; local wit="$R/repo/.git/tweakcc-witness/$T" result=0
  cat > "$BIN/mv" <<'PUB_PASS'
#!/usr/bin/env bash
/usr/bin/mv "$@" || exit $?
case "$2:$3" in */.pub.*:*/tweakcc-witness/*) printf 'published\n' > "$TEST_HOME/published"; exit 23 ;; esac
PUB_PASS
  chmod +x "$BIN/mv"
  cat > "$BIN/rm" <<'UNPUB_RM'
#!/usr/bin/env bash
for p in "$@"; do
  case "$p" in
    */tweakcc-witness/*)
      case "${p##*/}" in
        *[!0-9a-f]*|*.*|'') ;;
        *)
          if [ -f "$p" ]; then phase=exit; else phase=initial; fi
          /usr/bin/perl -e 'use Fcntl qw(:flock); open(my $f, ">>", $ARGV[0]) or exit 3; flock($f, LOCK_EX|LOCK_NB) or exit 1; exit 0;' "$p.lock"
          case $? in 0) state=free ;; 1) state=held ;; *) state=open-error ;; esac
          printf '%s %s\n' "$phase" "$state" >> "$TEST_HOME/unpub-events" ;;
      esac ;;
  esac
done
exec /usr/bin/rm "$@"
UNPUB_RM
  chmod +x "$BIN/rm"; : > "$H/unpub-events"
  produce
  [ "$RC" = 2 ] && [ -f "$H/published" ] && [ ! -e "$wit" ] || result=1
  [ "$(cat "$H/unpub-events")" = $'initial held\nexit held' ] || result=1
  printf 'release_after_unpublish: rc=%s result=%s\n%s\n' "$RC" "$result" "$(cat "$H/unpub-events")"
  return "$result"
}
case_release_unpublish_missing() { case_release_after_unpublish "$1"; }
case_missing_tool() {
  world "$1"; local missing="$2" tool path="$R/only-tools"
  mkdir -p "$path"
  for tool in git ssh rsync readlink tar gzip base64 cp mkdir rmdir uname find mktemp perl ps sed mv rm tr wc grep cat shasum sha256sum bash ln systemd-run pnpm node; do
    [ "$tool" != "$missing" ] || continue
    if [ -x "$BIN/$tool" ]; then ln -s "$BIN/$tool" "$path/$tool"; else ln -s "$(command -v "$tool")" "$path/$tool"; fi
  done
  (cd "$R/repo" && env PATH="$path" HOME="$H" TMPDIR="$R/tmp" TEST_HOME="$H" "$BASH" ${POSIX_ON:+--posix} scripts/run-witness.sh) > "$R/output" 2>&1
  RC=$?; OUT=$(cat "$R/output"); PRODUCER_EXECUTED=1
  [ "$RC" = 2 ] && [[ "$OUT" == *"ПРИБОР_НЕДОСТУПЕН: $missing"* ]]
}
case_missing_rm() { case_missing_tool "$1" rm; }
case_missing_tr() { case_missing_tool "$1" tr; }
case_missing_wc() { case_missing_tool "$1" wc; }
case_missing_grep() { case_missing_tool "$1" grep; }
case_missing_cat() { case_missing_tool "$1" cat; }
case_missing_gzip() { case_missing_tool "$1" gzip; }
case_typechange() {
  world "$1"; /usr/bin/rm "$R/repo/src/a.ts"; ln -s ../package.json "$R/repo/src/a.ts"
  git -C "$R/repo" add src/a.ts; produce; mode_full
}
case_atomic_publish() {
  world "$1"
  cat > "$BIN/mv" <<'PUB_MOVE'
#!/usr/bin/env bash
case "$2:$3" in */.pub.*:*/tweakcc-witness/*)
  [ ! -e "$3" ] && [ "$(wc -l < "$2" | tr -d ' ')" = 4 ] || exit 23
  printf '%s\n' "$2" > "$TEST_HOME/published-by-rename" ;;
esac
exec /usr/bin/mv "$@"
PUB_MOVE
  chmod +x "$BIN/mv"; produce
  [ "$RC" = 0 ] && [ -f "$H/published-by-rename" ] && [ -f "$WIT" ] || return 1
  local pub; pub=$(cat "$H/published-by-rename")
  [ ! -e "$R/repo/$pub" ]
}
case_publish_signal() {
  world "$1"
  cat > "$BIN/mv" <<'PUB_SIGNAL'
#!/usr/bin/env bash
/usr/bin/mv "$@" || exit $?
case "$2:$3" in */.pub.*:*/tweakcc-witness/*)
  printf 'renamed\n' > "$TEST_HOME/publish-signal"
  kill -TERM "$PPID" || exit 23 ;;
esac
PUB_SIGNAL
  chmod +x "$BIN/mv"; produce
  [ "$RC" = 143 ] && [ -f "$H/publish-signal" ] && [ ! -e "$WIT" ]
}
case_producer_index_race() {
  world "$1"; printf '{}\n' > "$R/repo/.prettierrc"; git -C "$R/repo" add .prettierrc
  /usr/bin/cp "$R/repo/.git/index" "$R/before-index"
  cat > "$BIN/cp" <<'INDEX_COPY'
#!/usr/bin/env bash
/usr/bin/cp "$@" || exit $?
case "$1:$2" in .git/index:*tweakcc-witness-index.*) git update-index --force-remove -- .prettierrc ;; esac
INDEX_COPY
  chmod +x "$BIN/cp"; produce
  local result=0
  /usr/bin/cp "$R/before-index" "$R/repo/.git/index" || result=1
  mode_full || { printf 'producer_index_race: full mode/door check failed\n'; result=1; }
  [ "$(sed -n '1p' "$WIT")" = 'files=.prettierrc,src/a.ts' ] || { printf 'producer_index_race: snapshot names check failed\n'; result=1; }
  return "$result"
}
case_producer_index_status_race() { case_producer_index_race "$1"; }
door_index_read_window() {
  world "$1"; printf '{}\n' > "$R/repo/.prettierrc"; git -C "$R/repo" add .prettierrc; produce
  [ "$RC" = 0 ] || return 1
  /usr/bin/cp "$R/repo/.git/index" "$R/before-index"
  export TEST_LIVE_INDEX="$R/repo/.git/index"
  cat > "$BIN/git" <<'DOOR_INDEX_READ'
#!/usr/bin/env bash
/usr/bin/git "$@"; rc=$?
case "$*" in 'diff --cached -M -z --name-only HEAD') GIT_INDEX_FILE="$TEST_LIVE_INDEX" /usr/bin/git update-index --force-remove -- .prettierrc || exit 23 ;; esac
exit "$rc"
DOOR_INDEX_READ
  chmod +x "$BIN/git"; door
  /usr/bin/cp "$R/before-index" "$R/repo/.git/index"; unset TEST_LIVE_INDEX
  [ "$DRC" = 0 ] && [[ "$DOUT" == *'mode full'* ]]
}
case_door_index_race() {
  door_index_read_window "$1-read" && door_index_copy_window "$1-copy"
}
door_index_copy_window() {
  world "$1"; printf '{}\n' > "$R/repo/.prettierrc"; git -C "$R/repo" add .prettierrc; produce
  [ "$RC" = 0 ] || return 1
  /usr/bin/cp "$R/repo/.git/index" "$R/before-index"
  cat > "$BIN/cp" <<'DOOR_INDEX_COPY'
#!/usr/bin/env bash
/usr/bin/cp "$@" || exit $?
case "$1:$2" in .git/index:*tweakcc-door-index.*) /usr/bin/git update-index --force-remove -- .prettierrc ;; esac
DOOR_INDEX_COPY
  chmod +x "$BIN/cp"; door
  /usr/bin/cp "$R/before-index" "$R/repo/.git/index"
  [ "$DRC" = 0 ] && [[ "$DOUT" == *'mode full'* ]]
}
case_stand_meta() {
  local name="$1" kind="$2" meta="$ROOT/$1-meta" stand="${SUT_STAND:-$HERE/test-run-witness.sh}" rc
  mkdir -p "$meta/bin"
  sed '/^for name in /,$d' "$stand" | sed "s|^HERE=.*|HERE=\"$HERE\"|" > "$meta/runner"
  sed -n '/^for name in /,/^done$/p' "$stand" | sed 's/^for name in .*; do$/for name in local_escape; do/' >> "$meta/runner"
  printf '\n[ "$FAIL" = 0 ] || exit 1\n' >> "$meta/runner"
  cat > "$meta/bin/cp" <<'META_COPY'
#!/usr/bin/env bash
case "$2" in */repo/scripts/run-witness.sh) [ "$META_KIND" = copy ] && exit 23; exit 0 ;; esac
exec /usr/bin/cp "$@"
META_COPY
  chmod +x "$meta/bin/cp"
  env PATH="$meta/bin:$PATH" META_KIND="$kind" WITNESS_RED_FIRST=1 "$BASH" ${POSIX_ON:+--posix} "$meta/runner" > "$meta/output" 2>&1
  rc=$?; OUT=$(cat "$meta/output"); RC=$rc
  [ "$rc" = 2 ] && [[ "$OUT" == *"ERROR $kind producer"* ]] && [[ "$OUT" != *RED-FIRST* ]]
}
case_stand_copy_error() { case_stand_meta "$1" copy; }
case_stand_exec_error() { case_stand_meta "$1" exec; }
dead_setup_probe() {
  local stand="$1" meta="$ROOT/dead-setup-control" rc
  mkdir -p "$meta"
  "$REAL_NODE" - "$stand" "$meta/runner" <<'DEAD_SETUP_RUNNER'
const fs = require('node:fs');
const path = require('node:path');
const [stand, dst] = process.argv.slice(2);
let code = fs.readFileSync(stand, 'utf8').split('\nremove_trigger()')[0];
code = code.replace(/^HERE=.*$/m, () => 'HERE=' + JSON.stringify(path.dirname(stand)));
code = code.replace(/^for name in .*; do$/m, 'for name in dead_lock; do');
const before = "    dead_lock) sed -i '/^    if ! exec 9>>/i\\    [ ! -s \"$LOCK\" ] || exit 8' \"$dst/run-witness.sh\" ;;";
const after = '    dead_lock) mutate_literal "$dst/run-witness.sh" \'    my $owner = "pid=$ARGV[1] host=$ARGV[2] runid=$ARGV[3]\\n";\' \'    my $owner = "\\n";\' ;;';
if (code.split(before).length !== 2) { console.error('ERROR dead setup anchor'); process.exit(2); }
code = code.replace(before, () => after);
code += '\n[ "$FAIL" = 0 ] || exit 1\n';
fs.writeFileSync(dst, code);
DEAD_SETUP_RUNNER
  [ "$?" = 0 ] || exit 2
  "$BASH" ${POSIX_ON:+--posix} "$meta/runner" > "$meta/output" 2>&1
  rc=$?; printf 'dead_setup_control RC=%s\n' "$rc"; cat "$meta/output"
  [ "$rc" = 2 ] && grep -Fq 'FAIL dead_lock setup' "$meta/output" && grep -Fq 'ОТКАЗ ПРИБОРА' "$meta/output"
}
oracle_setup_probe() {
  local stand="$1" kind="$2" meta rc
  meta=$(mktemp -d "$ROOT/oracle-setup-$kind.XXXXXX") || exit 2
  mkdir -p "$meta/bin"
  "$REAL_NODE" - "$stand" "$meta/runner" "$HERE" <<'ORACLE_SETUP_RUNNER'
const fs = require('node:fs');
const [stand, dst, here] = process.argv.slice(2);
let code = fs.readFileSync(stand, 'utf8').split('\nremove_trigger()')[0];
code = code.replace(/^HERE=.*$/m, () => 'HERE=' + JSON.stringify(here));
code = code.replace(/^for name in .*; do$/m, 'for name in local_escape; do');
code += '\n[ "$FAIL" = 0 ] || exit 1\n';
fs.writeFileSync(dst, code);
ORACLE_SETUP_RUNNER
  [ "$?" = 0 ] || exit 2
  # CONSTRAINT: only the oracle-index copy or its write-tree fails; every other cp and git of the nested stand stays real.
  case "$kind" in
    cp) cat > "$meta/bin/cp" <<'ORACLE_COPY'
#!/usr/bin/env bash
for last; do :; done
case "$last" in */oracle-index) exit 23 ;; esac
exec /usr/bin/cp "$@"
ORACLE_COPY
      ;;
    write-tree) cat > "$meta/bin/git" <<'ORACLE_TREE'
#!/usr/bin/env bash
case "${GIT_INDEX_FILE:-}" in */oracle-index) for a; do [ "$a" != write-tree ] || exit 23; done ;; esac
exec /usr/bin/git "$@"
ORACLE_TREE
      ;;
    *) printf 'ОТКАЗ ПРИБОРА: вид зонда %s\n' "$kind"; exit 2 ;;
  esac
  chmod +x "$meta/bin/"*
  env PATH="$meta/bin:$PATH" "$BASH" ${POSIX_ON:+--posix} "$meta/runner" > "$meta/output" 2>&1
  rc=$?; printf 'oracle_setup_control kind=%s stand=%s RC=%s\n' "$kind" "$stand" "$rc"; cat "$meta/output"
  [ "$rc" = 2 ] && grep -Fq 'ERROR oracle-index producer' "$meta/output" && ! grep -Fq 'RED-FIRST' "$meta/output" && ! grep -Fq 'КРАСНАЯ' "$meta/output"
}
oracle_setup_control() {
  local kind="$1" key="$2" dst="$ROOT/control-$2"
  oracle_setup_probe "$HERE/test-run-witness.sh" "$kind" || return 1
  mkdir -p "$dst"
  mutate "$key" "$dst"
  if oracle_setup_probe "$dst/stand" "$kind"; then
    printf 'самопроверка: зонд %s прошёл на мутации %s\n' "$kind" "$key"; return 1
  fi
  printf 'самопроверка: зонд %s отказал на мутации %s\n' "$kind" "$key"
}
mutation_changed() {
  "$REAL_NODE" - "$@" <<'MUTATION_CHANGED'
const fs = require('node:fs');
const [key, before, after] = process.argv.slice(2);
if (fs.readFileSync(before).equals(fs.readFileSync(after))) {
  console.error('ОТКАЗ ПРИБОРА: мутация ' + key + ' не изменила файл');
  process.exit(2);
}
MUTATION_CHANGED
  [ "$?" = 0 ] || exit 2
}
mutate_literal() {
  "$REAL_NODE" - "$@" <<'MUTATE_LITERAL'
const fs = require('node:fs');
const [file, before, after] = process.argv.slice(2);
const code = fs.readFileSync(file, 'utf8');
if (code.split(before).length !== 2) {
  console.error('mutation anchor must occur once: ' + before); process.exit(2);
}
fs.writeFileSync(file, code.replace(before, () => after));
MUTATE_LITERAL
  [ "$?" = 0 ] || exit 2
}
mutate() {
  local key="$1" dst="$2"
  cp "$PRODUCER" "$dst/run-witness.sh"; cp "$DOOR" "$dst/door"
  [ ! -f "$RULES" ] || cp "$RULES" "$dst/witness-rules.sh"
  case "$key" in
    local_escape|remote_escape|alias) sed -i '/^physical_path()/,/^}/c\physical_path() { local p="$1" t; while [ -L "$p" ]; do t=$(readlink "$p") || return 2; case "$t" in /*) p="$t" ;; *) p="$(dirname "$p")/$t" ;; esac; done; p=$(realpath -ms "$p") || return 2; printf "%s" "$p"; }' "$dst/run-witness.sh" ;;
    root_link) sed -i '/^  case "\$p" in/i\  [ "$p" != "$root" ] || return 1' "$dst/run-witness.sh" ;;

    utf8|utf8_related) sed -i 's/if (!Buffer.from(name, '\''utf8'\'').equals(raw))/if (false)/' "$dst/run-witness.sh" ;;
    utf8_delete) sed -i 's/FILES64=$(base64 < "\$THP")/FILES64=$(base64 < "$FL")/' "$dst/run-witness.sh" ;;
    busy) sed -i 's/^acquire_lock$/# disabled lock/' "$dst/run-witness.sh" ;;
    dead_lock) sed -i '/^    if ! exec 9>>/i\    [ ! -s "$LOCK" ] || exit 8' "$dst/run-witness.sh" ;;
    producer_index_lock|alternate_index) sed -i 's/GIT_INDEX_FILE="\$IDXSNAP" git write-tree/git write-tree/' "$dst/run-witness.sh" ;;
    door_index_lock) sed -i 's/GIT_INDEX_FILE="\$IDXSNAP" git write-tree/git write-tree/' "$dst/door" ;;
    producer_cleanup) sed -i 's/rm -rf "\$TMP" || cleanup_error "\$TMP"/rm -rf "$TMP"; :/' "$dst/run-witness.sh" ;;
    door_cleanup) sed -i 's/rm -f "\$FL" || door_cleanup_error "\$FL"/rm -f "$FL"; :/' "$dst/door" ;;
    unicode_delete) sed -i 's/D|T|R\*|C\*)/R*|C*)/' "$dst/witness-rules.sh" ;;
    unicode_setup) sed -i '/^src\/tests\/setup\/\*/d' "$dst/witness-rules.sh" ;;
    unicode_rename) sed -i 's/D|T|R\*|C\*)/D)/' "$dst/witness-rules.sh" ;;
    recipe_rename) sed -i 's/diff-tree -r -M -z/diff-tree -r -z/' "$dst/run-witness.sh" ;;
    config_rename) sed -i 's/witness_path_mode "\$st" "\$new"/:/' "$dst/witness-rules.sh" ;;
    newline) sed -i 's/git hash-object --no-filters -- "\$TMP\/\$path"/printf "%s\\n" "$TMP\/$path" | git hash-object --no-filters --stdin-paths/' "$dst/run-witness.sh" ;;
    manifest) sed -i 's/tar -h -czf/tar -czf/' "$dst/run-witness.sh" ;;
    remote_find) sed -i 's/ > "\$LFQ" || { printf .*find.*exit 11; }/ > "$LFQ"/' "$dst/run-witness.sh" ;;
    host) sed -i 's/| -\*)/)/; s/\x27\x27|-\*|/\x27\x27|/' "$dst/run-witness.sh" ;;
    glob) sed -i "s/Object.keys(cfg)/['*.{ts,tsx}', '*.{json,md}']/" "$dst/run-witness.sh" ;;
    bad_js) sed -i "s/f.startsWith('src\/')/(f.startsWith('src\/') \&\& !f.endsWith('.js'))/" "$dst/run-witness.sh" ;;
    dash_related) sed -i 's/--ignore-unknown --%s/--ignore-unknown%s/' "$dst/run-witness.sh" ;;
    dash_full) sed -i "s/,'--',\.\.\.files/,\.\.\.files/" "$dst/run-witness.sh" ;;
    lock_inode_retry|lock_age_race) mutate_literal "$dst/run-witness.sh" '    exit 3 unless @path && $fd[0] == $path[0] && $fd[1] == $path[1];' '    # inode comparison removed' ;;
    lock_retry_limit) mutate_literal "$dst/run-witness.sh" '[ "$attempt" -lt 8 ]' '[ "$attempt" -lt 7 ]' ;;
    lock_persistent|lock_inherited) mutate_literal "$dst/run-witness.sh" '  exec 9>&- || return 6' '  rm -f "$LOCK"; exec 9>&- || return 6' ;;
    lock_directory) sed -i 's/ЗАМОК_НЕЧИТАЕМ/ЗАМОК_ЗАНЯТ/' "$dst/run-witness.sh" ;;
    lock_perl_error) mutate_literal "$dst/run-witness.sh" "*) fail 'ПРИБОР_НЕДОСТУПЕН: flock' ;;" "*) fail 'ПРИБОР_НЕДОСТУПЕН: rename' ;;" ;;
    lock_three) mutate_literal "$dst/run-witness.sh" '    flock($f, LOCK_EX|LOCK_NB) or exit(($!{EWOULDBLOCK} || $!{EAGAIN}) ? 1 : 2);' '    flock($f, LOCK_EX|LOCK_NB) or exit 0;' ;;
    lock_age_cleanup) mutate_literal "$dst/run-witness.sh" '  if (!flock($f, LOCK_EX|LOCK_NB)) {
    $err = "$!";
    if ($!{EWOULDBLOCK} || $!{EAGAIN}) { $close->($f, $name); next; }
    $warn->($name, "захват", $err);
    $close->($f, $name);
    next;
  }' '  # cleanup flock removed' ;;
    lock_age_cleanup_continue) mutate_literal "$dst/run-witness.sh" '    printf STDERR "run-witness: ПРЕДУПРЕЖДЕНИЕ уборка замка %s: открытие: %s\n", $name, $err;' '    exit 2;' ;;
    lock_age_continue_exit) mutate_literal "$dst/run-witness.sh" '    printf STDERR "run-witness: ПРЕДУПРЕЖДЕНИЕ уборка замка %s: открытие: %s\n", $name, $err;
    $rc = 2;
    next;' '    printf STDERR "run-witness: ПРЕДУПРЕЖДЕНИЕ уборка замка %s: открытие: %s\n", $name, $err;
    $rc = 2;
    exit 2;' ;;
    cleanup_age_stat) mutate_literal "$dst/run-witness.sh" '    $warn->($name, "состояние пути", "$!") unless $!{ENOENT};' '    # path-stat refusal discarded' ;;
    cleanup_path_stat) mutate_literal "$dst/run-witness.sh" '    $warn->($name, "состояние пути после открытия", "$!") unless $!{ENOENT};' '    # post-open path-stat refusal discarded' ;;
    cleanup_fd_stat) mutate_literal "$dst/run-witness.sh" '    $warn->($name, "состояние fd", "$!");' '    $warn->($name, "состояние fd", "");' ;;
    cleanup_close_busy) mutate_literal "$dst/run-witness.sh" '    if ($!{EWOULDBLOCK} || $!{EAGAIN}) { $close->($f, $name); next; }' '    if ($!{EWOULDBLOCK} || $!{EAGAIN}) { close($f); next; }' ;;
    cleanup_close_flock) mutate_literal "$dst/run-witness.sh" '    $warn->($name, "захват", $err);
    $close->($f, $name);' '    $warn->($name, "захват", $err);
    close($f);' ;;
    cleanup_close_fd) mutate_literal "$dst/run-witness.sh" '    $warn->($name, "состояние fd", "$!");
    $close->($f, $name);' '    $warn->($name, "состояние fd", "$!");
    close($f);' ;;
    cleanup_close_path_missing) mutate_literal "$dst/run-witness.sh" '    $warn->($name, "состояние пути после открытия", "$!") unless $!{ENOENT};
    $close->($f, $name);' '    $warn->($name, "состояние пути после открытия", "$!") unless $!{ENOENT};
    close($f);' ;;
    cleanup_close_inode) mutate_literal "$dst/run-witness.sh" '  if ($fd[0] != $path[0] || $fd[1] != $path[1]) { $close->($f, $name); next; }' '  if ($fd[0] != $path[0] || $fd[1] != $path[1]) { close($f); next; }' ;;
    cleanup_close_final|cleanup_close_unlink) mutate_literal "$dst/run-witness.sh" '  if (!unlink($path)) { $warn->($name, "удаление", "$!"); }
  $close->($f, $name);' '  if (!unlink($path)) { $warn->($name, "удаление", "$!"); }
  close($f);' ;;
    cleanup_opendir) mutate_literal "$dst/run-witness.sh" 'открытие каталога: %s' 'каталог: %s' ;;
    cleanup_closedir) mutate_literal "$dst/run-witness.sh" 'закрытие каталога: %s' 'каталог: %s' ;;
    release_after_unpublish) mutate_literal "$dst/run-witness.sh" '  if [ "$rc" != 0 ] && [ "$PUBLISHED" = 1 ]; then
    rm -f "$GITDIR/tweakcc-witness/$T" || { cleanup_error "$GITDIR/tweakcc-witness/$T"; rc=6; }
  fi
  # CONSTRAINT: fd-close failure does not invalidate passed checks; unpublishing after release could remove the next producer'"'"'s witness.
  release_lock || { cleanup_error "$LOCK"; rc=6; }' '  release_lock || { cleanup_error "$LOCK"; rc=6; }
  if [ "$rc" != 0 ] && [ "$PUBLISHED" = 1 ]; then
    rm -f "$GITDIR/tweakcc-witness/$T" || { cleanup_error "$GITDIR/tweakcc-witness/$T"; rc=6; }
  fi' ;;
    release_unpublish_missing) mutate_literal "$dst/run-witness.sh" '  if [ "$rc" != 0 ] && [ "$PUBLISHED" = 1 ]; then
    rm -f "$GITDIR/tweakcc-witness/$T" || { cleanup_error "$GITDIR/tweakcc-witness/$T"; rc=6; }
  fi' '  # unpublication removed' ;;
    produce_setup_return)
      cp "$HERE/test-run-witness.sh" "$dst/stand"
      mutate_literal "$dst/stand" "  cp \"\$index\" \"\$R/oracle-index\" || { printf 'ERROR oracle-index producer\\n' >&2; exit 2; }" '  cp "$index" "$R/oracle-index" || return 2' ;;
    produce_tree_return)
      cp "$HERE/test-run-witness.sh" "$dst/stand"
      mutate_literal "$dst/stand" "  T=\$(GIT_INDEX_FILE=\"\$R/oracle-index\" git -C \"\$R/repo\" write-tree) || { printf 'ERROR oracle-index producer\\n' >&2; exit 2; }" '  T=$(GIT_INDEX_FILE="$R/oracle-index" git -C "$R/repo" write-tree) || return 2' ;;
    missing_*) local tool="${key#missing_}"; sed -i "/^for tool in /s/ $tool\([ ;]\)/\1/" "$dst/run-witness.sh" ;;
    inert-ghost) sed -i 's/TWEAKCC-WITNESS-INERT-GHOST-523/x/' "$dst/run-witness.sh" ;;
    typechange) sed -i 's/D|T|R\*|C\*)/D|R*|C*)/' "$dst/witness-rules.sh" ;;
    atomic_publish) sed -i 's/> "\$PUB" || fail/> "$GITDIR\/tweakcc-witness\/$T" || fail/; /^mv -f "\$PUB" /c\:' "$dst/run-witness.sh" ;;
    publish_signal) sed -i '/^PUBLISHED=1$/d; /^PUB=""$/a\PUBLISHED=1' "$dst/run-witness.sh" ;;
    producer_index_race) sed -i 's/GIT_INDEX_FILE="\$IDXSNAP" git diff --cached -M -z --name-only/git diff --cached -M -z --name-only/' "$dst/run-witness.sh" ;;
    producer_index_status_race) sed -i 's/GIT_INDEX_FILE="\$IDXSNAP" git diff --cached -M -z --name-status/git diff --cached -M -z --name-status/' "$dst/run-witness.sh" ;;
    door_index_race) sed -i 's/GIT_INDEX_FILE="\$IDXSNAP" git diff/git diff/' "$dst/door" ;;
    stand_copy_error|stand_exec_error)
      cp "$HERE/test-run-witness.sh" "$dst/stand"
      if [ "$key" = stand_copy_error ]; then
        sed -i 's/^  cp "\$SUT" "\$R\/repo\/scripts\/run-witness.sh".*/  cp "$SUT" "$R\/repo\/scripts\/run-witness.sh"/' "$dst/stand"
      else
        sed -i 's/if \[ "\$PRODUCER_EXECUTED" != 1 \]; then/if false; then/' "$dst/stand"
      fi ;;
  esac
  local before="$PRODUCER" after="$dst/run-witness.sh"
  case "$key" in
    door_index_lock|door_cleanup|door_index_race) before="$DOOR"; after="$dst/door" ;;
    unicode_delete|unicode_setup|unicode_rename|config_rename|typechange) before="$RULES"; after="$dst/witness-rules.sh" ;;
    stand_copy_error|stand_exec_error|produce_setup_return|produce_tree_return) before="$HERE/test-run-witness.sh"; after="$dst/stand" ;;
  esac
  mutation_changed "$key" "$before" "$after"
}
for name in local_escape remote_escape root_link utf8 utf8_delete utf8_related alias busy dead_lock producer_index_lock door_index_lock alternate_index producer_cleanup door_cleanup unicode_delete unicode_setup unicode_rename recipe_rename config_rename newline manifest remote_find host glob bad_js dash_related dash_full lock_inode_retry lock_retry_limit lock_persistent lock_directory lock_perl_error lock_inherited lock_age_cleanup lock_age_cleanup_continue lock_age_race lock_three release_after_unpublish missing_rm missing_tr missing_wc missing_grep missing_cat missing_gzip typechange atomic_publish publish_signal producer_index_race producer_index_status_race door_index_race stand_copy_error stand_exec_error cleanup_age_stat cleanup_path_stat cleanup_fd_stat cleanup_close_busy cleanup_close_flock cleanup_close_fd cleanup_close_path_missing cleanup_close_inode cleanup_close_final cleanup_close_unlink cleanup_opendir cleanup_closedir lock_age_continue_exit release_unpublish_missing; do
  PROBE=""; SUT="$PRODUCER"; SUT_RULES="$RULES"; SUT_STAND="$HERE/test-run-witness.sh"
  OUT=""; DOUT=""; WIT=""; RC=0; PRODUCER_EXECUTED=0
  if "case_$name" "base-$name"; then
    base=1
  else
    case_rc=$?
    if [ "$case_rc" = 2 ]; then printf 'ОТКАЗ ПРИБОРА: подготовка %s rc=2\n' "$name"; exit 2; fi
    base=0
    case "$name" in
      stand_*) printf 'STAND-FIRST %s: requirement not met\n%s\n' "$name" "$OUT" ;;
      *)
        if [ "$PRODUCER_EXECUTED" != 1 ]; then
          printf 'ERROR exec producer: %s\n%s\n' "$name" "$OUT" >&2; exit 2
        fi
        printf 'RED-FIRST %s: requirement not met\n%s\n%s\n' "$name" "$OUT" "$DOUT" ;;
    esac
  fi
  if [ "${WITNESS_RED_FIRST:-0}" = 1 ]; then
    [ "$base" = 1 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
    continue
  fi
  mkdir -p "$ROOT/mutation-$name"
  mutate "$name" "$ROOT/mutation-$name"
  SUT="$ROOT/mutation-$name/run-witness.sh"; SUT_RULES="$ROOT/mutation-$name/witness-rules.sh"
  [ ! -f "$ROOT/mutation-$name/stand" ] || SUT_STAND="$ROOT/mutation-$name/stand"
  saved_door="$DOOR"; DOOR="$ROOT/mutation-$name/door"; PROBE=""
  MUT_TOTAL=$((MUT_TOTAL+1))
  if "case_$name" "mut-$name"; then
    red=0
  else
    case_rc=$?
    if [ "$case_rc" = 2 ]; then printf 'ОТКАЗ ПРИБОРА: подготовка мутации %s rc=2\n' "$name"; exit 2; fi
    red=1; MUT_RED=$((MUT_RED+1))
  fi
  DOOR="$saved_door"
  if [ "$base" = 1 ] && [ "$red" = 1 ]; then
    PASS=$((PASS+1)); printf 'ok %s; мутация %s: КРАСНАЯ\n' "$name" "$name"
  else
    FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s base=%s mutation-red=%s\n%s\n%s\n' "$name" "$base" "$red" "${OUT:-}" "${DOUT:-}"
  fi
done
remove_trigger() {
  "$REAL_NODE" - "$1" "$2" <<'REMOVE'
const fs = require('node:fs');
const [file, row] = process.argv.slice(2);
let code = fs.readFileSync(file, 'utf8');
for (const variable of ['WITNESS_MANIFESTS', 'WITNESS_LINT_CONFIGS', 'WITNESS_OTHER_TRIGGERS']) {
  const re = new RegExp(variable + "='([^']*)'");
  code = code.replace(re, (_, value) => {
    const separator = variable === 'WITNESS_MANIFESTS' ? ' ' : '\n';
    return variable + "='" + value.split(separator).filter(p => p !== row).join(separator) + "'";
  });
}
fs.writeFileSync(file, code);
REMOVE
}
table_case() {
  local name="$1" pattern="$2" status="$3" rules="$4" path="${2//\*/row}"
  PROBE=""; SUT="$PRODUCER"; SUT_RULES="$rules"; world "$name"
  if [ -f "$R/repo/$path" ]; then
    git -C "$R/repo" rm -q -- "$path" || return 1
    git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm without-row || return 1
  fi
  mkdir -p "$R/repo/$(dirname "$path")"
  case "$status" in
    A) printf 'row\n' > "$R/repo/$path"; git -C "$R/repo" add -- "$path" ;;
    M) printf 'old\n' > "$R/repo/$path"; git -C "$R/repo" add -- "$path"; git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm tracked-row; printf 'new\n' > "$R/repo/$path"; git -C "$R/repo" add -- "$path" ;;
    R) printf 'row\n' > "$R/repo/old-row"; git -C "$R/repo" add old-row; git -C "$R/repo" -c core.hooksPath=/dev/null commit -qm old-row; git -C "$R/repo" mv old-row "$path" ;;
  esac
  git -C "$R/repo" diff --cached -M -z --name-status HEAD > "$R/status" || return 1
  (
    fail() { printf 'table: %s\n' "$1" >&2; exit 2; }
    source "$rules"
    witness_status_mode "$R/status"
    printf 'table pattern=%s status=%s mode=%s\n' "$pattern" "$status" "$needed"
    [ "$needed" = full ]
  ) > "$R/table-output" 2>&1
}
TABLE=$(source "$RULES"; witness_patterns)
ROWS=0; REDUNDANCY=0
while IFS= read -r pattern; do
  ROWS=$((ROWS+1))
  case "$pattern" in src/*) statuses='A M R' ;; *) statuses='A R' ;; esac
  for status in $statuses; do
    name="table-$ROWS-$status"
    kind='row deletion'
    case "$pattern:$status" in src/*:R) kind='joint row + R/C status deletion' ;; esac
    if table_case "base-$name" "$pattern" "$status" "$RULES"; then base=1; else base=0; fi
    if [ "${WITNESS_RED_FIRST:-0}" = 1 ]; then
      [ "$base" = 1 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
      printf 'table coverage %s pattern=%s base=%s\n' "$name" "$pattern" "$base"
      continue
    fi
    mutation="$ROOT/$name-rules.sh"; cp "$RULES" "$mutation"
    remove_trigger "$mutation" "$pattern" || exit 2
    mutation_changed "$name-row" "$RULES" "$mutation"
    case "$pattern:$status" in src/*:R)
      half="$ROOT/$name-half-rules.sh"; cp "$mutation" "$half"
      sed -i 's/D|T|R\*|C\*)/D)/' "$mutation"
      mutation_changed "$name-status" "$half" "$mutation"
    esac
    MUT_TOTAL=$((MUT_TOTAL+1))
    if table_case "mut-$name" "$pattern" "$status" "$mutation"; then red=0; else red=1; MUT_RED=$((MUT_RED+1)); fi
    if [ "$base" = 1 ] && [ "$red" = 1 ]; then
      PASS=$((PASS+1)); printf 'ok %s pattern=%s; мутация %s: КРАСНАЯ (%s)\n' "$name" "$pattern" "$name" "$kind"
    else
      FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s pattern=%s base=%s mutation-red=%s\n' "$name" "$pattern" "$base" "$red"
    fi
    case "$pattern:$status" in src/*:R)
      for control in row status; do
        mutation="$ROOT/$name-$control-rules.sh"; cp "$RULES" "$mutation"
        if [ "$control" = row ]; then remove_trigger "$mutation" "$pattern" || exit 2; else sed -i 's/D|T|R\*|C\*)/D)/' "$mutation"; fi
        mutation_changed "$name-$control" "$RULES" "$mutation"
        if [ "$base" = 1 ] && table_case "redundant-$name-$control" "$pattern" R "$mutation"; then
          REDUNDANCY=$((REDUNDANCY+1)); printf 'ok избыточное покрытие %s single-%s: full -> full\n' "$name" "$control"
        else
          printf 'ПРОВАЛ избыточное покрытие %s single-%s\n' "$name" "$control"; exit 1
        fi
      done ;;
    esac
  done
done <<TABLE_ROWS
$TABLE
TABLE_ROWS
if [ "${WITNESS_RED_FIRST:-0}" != 1 ]; then
  mkdir -p "$ROOT/mutation-inert-ghost"
  ( mutate inert-ghost "$ROOT/mutation-inert-ghost" ) > "$ROOT/inert-named.log" 2>&1
  inert_rc=$?
  if [ "$inert_rc" = 2 ] && grep -Fq 'ОТКАЗ ПРИБОРА' "$ROOT/inert-named.log"; then
    INERT_CONTROLS=$((INERT_CONTROLS+1))
    printf 'ok контроль инертности: именованная мутация с чужим якорем отказана прибором (rc=2)\n'
  else
    printf 'ПРОВАЛ контроль инертности: именованный путь rc=%s\n' "$inert_rc"; exit 1
  fi
  mutation="$ROOT/inert-table-rules.sh"; cp "$RULES" "$mutation"
  remove_trigger "$mutation" 'ghost-row-523' || exit 2
  ( mutation_changed inert-table "$RULES" "$mutation" ) > "$ROOT/inert-table.log" 2>&1
  inert_rc=$?
  if [ "$inert_rc" = 2 ] && grep -Fq 'ОТКАЗ ПРИБОРА' "$ROOT/inert-table.log"; then
    INERT_CONTROLS=$((INERT_CONTROLS+1))
    printf 'ok контроль инертности: табличная строка-призрак отказана прибором (rc=2)\n'
  else
    printf 'ПРОВАЛ контроль инертности: табличный путь rc=%s\n' "$inert_rc"; exit 1
  fi
  if dead_setup_probe "$HERE/test-run-witness.sh" > "$ROOT/dead-setup-control.log" 2>&1; then
    INERT_CONTROLS=$((INERT_CONTROLS+1))
    printf 'ok контроль подготовки: пустая строка владельца отказана прибором (rc=2)\n'
  else
    cat "$ROOT/dead-setup-control.log"
    printf 'ПРОВАЛ контроль подготовки dead_lock\n'; exit 1
  fi
  for oracle in cp:produce_setup_return write-tree:produce_tree_return; do
    if oracle_setup_control "${oracle%%:*}" "${oracle#*:}" > "$ROOT/oracle-setup-${oracle%%:*}.log" 2>&1; then
      INERT_CONTROLS=$((INERT_CONTROLS+1))
      printf 'ok контроль подготовки: отказ %s индекса оракула отказан прибором (rc=2); самопроверка: мутация %s роняет зонд\n' "${oracle%%:*}" "${oracle#*:}"
    else
      cat "$ROOT/oracle-setup-${oracle%%:*}.log"
      printf 'ПРОВАЛ контроль подготовки oracle-index (самопроверка)\n'; exit 1
    fi
  done
fi
printf 'trigger rows: %s, expected %s; избыточное покрытие: %s/2; контроли инертности и подготовки: %s/5\n' "$ROWS" "$EXPECTED_TRIGGER_ROWS" "$REDUNDANCY" "$INERT_CONTROLS"
[ "$ROWS" = "$EXPECTED_TRIGGER_ROWS" ] || exit 1
[ "${WITNESS_RED_FIRST:-0}" = 1 ] || [ "$REDUNDANCY" = 2 ] || exit 1
[ "${WITNESS_RED_FIRST:-0}" = 1 ] || [ "$INERT_CONTROLS" = 5 ] || exit 1
printf '%s passed, %s failed, expected %s\n' "$PASS" "$FAIL" "$EXPECTED_TEETH"
printf 'мутации: %s/%s красные\n' "$MUT_RED" "$MUT_TOTAL"
[ "$((PASS+FAIL))" = "$EXPECTED_TEETH" ] && [ "$FAIL" = 0 ] || exit 1
[ "${WITNESS_RED_FIRST:-0}" = 1 ] || [ "$MUT_RED" = "$EXPECTED_TEETH" ] || exit 1
