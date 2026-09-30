#!/usr/bin/env bash
# CONSTRAINT: T is a snapshot of the active index, including GIT_INDEX_FILE under commit --only.
# CONSTRAINT: named trees use --tree and --files together; files= uses the same encoding as the hook.
# CONSTRAINT: full absorbs related; status parsing and installation triggers live in witness-rules.sh.
# CONSTRAINT: local and delivered symlinks must resolve physically within the snapshot, including its root; dangling tails are allowed.
# CONSTRAINT: TWEAKCC_WITNESS_LOCK_TEST_HOOK runs only between open and flock, as the user already controlling PATH for git/ssh/pnpm; it adds no execution capability.
# CONSTRAINT: tracked top-level node_modules and submodules cannot supply snapshot dependencies.
# CONSTRAINT: the remote snapshot is unique to this run and is removed on every outcome.
# CONSTRAINT: one T is serialized by kernel flock on fd 9's open description; holders only close it, never unlink their path, so surviving descendants keep T busy.
# CONSTRAINT: manifests are hashed and delivered as the same dereferenced bytes under one remote dependency flock.
# CONSTRAINT: publication follows successful checks AND all snapshot cleanup; an EXIT cleanup failure removes this run's witness while still holding the tree lock.
# Return codes: 2 input/transport refusal; 4 failed checks/install; 6 cleanup failure; 8 busy tree lock.
set -u
set -o pipefail
export LC_ALL=C
fail() { printf 'run-witness: ОТКАЗ %s\n' "$1" >&2; exit 2; }
fail_run() { printf 'run-witness: ОТКАЗ ПРОГОН: %s\n' "$1" >&2; exit 4; }
fail_cleanup() { printf 'run-witness: ОТКАЗ УБОРКА: %s\n' "$1" >&2; exit 6; }
for tool in git ssh rsync readlink tar gzip base64 cp mkdir uname find mktemp perl mv rm tr wc grep cat; do
  command -v "$tool" >/dev/null || fail "ПРИБОР_НЕДОСТУПЕН: $tool"
done
if command -v shasum >/dev/null; then HASHCMD='shasum -a 256'
elif command -v sha256sum >/dev/null; then HASHCMD=sha256sum
else fail 'ПРИБОР_НЕДОСТУПЕН: sha256'; fi
HOST="${TWEAKCC_WITNESS_HOST:-usbox}"
case "$HOST" in ''|-*|*[!A-Za-z0-9._-]*) fail "ХОСТ: недопустимое значение TWEAKCC_WITNESS_HOST: $HOST" ;; esac
MODE_TREE=""; MODE_FILES=""; seen_tree=0; seen_files=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tree) [ "$seen_tree" = 0 ] || fail 'АРГУМЕНТЫ: повтор --tree'; shift; [ $# -gt 0 ] || fail 'АРГУМЕНТЫ: --tree без значения'; MODE_TREE="$1"; seen_tree=1 ;;
    --files) [ "$seen_files" = 0 ] || fail 'АРГУМЕНТЫ: повтор --files'; shift; [ $# -gt 0 ] || fail 'АРГУМЕНТЫ: --files без значения'; MODE_FILES="$1"; seen_files=1 ;;
    *) fail "АРГУМЕНТЫ: неизвестный аргумент: $1" ;;
  esac
  shift
done
if [ "$seen_tree" = 1 ] || [ "$seen_files" = 1 ]; then
  [ "$seen_tree" = 1 ] && [ "$seen_files" = 1 ] || fail 'АРГУМЕНТЫ: --tree и --files даются парой'
  [ -n "$MODE_TREE" ] && [ -n "$MODE_FILES" ] || fail 'АРГУМЕНТЫ: пустое значение'
fi
top=$(git rev-parse --show-toplevel) || fail 'ПРИБОР_НЕДОСТУПЕН: git rev-parse --show-toplevel'
cd "$top" || fail "корень не открывается: $top"
source "$top/scripts/witness-rules.sh" || fail 'ПРИБОР_НЕДОСТУПЕН: witness-rules.sh'
GITDIR=$(git rev-parse --git-dir) || fail 'git rev-parse --git-dir отказ'
mkdir -p "$GITDIR/tweakcc-witness" || fail 'каталог свидетелей не создан'
TMP=""; TMPIDX=""; IDXSNAP=""; TLS=""; THP=""; IS=""; RS0=""; RS=""; MT=""; SLF=""; FL=""; MSL=""; NODEPATHS=""
T=""; RUNID=""; LOCK=""; PUB=""; LOCKED=0; PUBLISHED=0; REMOTE_ARMED=0
cleanup_error() { printf 'run-witness: ОТКАЗ УБОРКА: cleanup failed: %s\n' "$1" >&2; CLEAN_RC=6; }
local_cleanup() {
  local name value
  CLEAN_RC=0
  if [ -n "$TMP" ]; then
    rm -rf "$TMP" || cleanup_error "$TMP"
    [ "$CLEAN_RC" = 0 ] && TMP=""
  fi

  for name in TMPIDX IDXSNAP TLS THP IS RS0 RS MT SLF FL MSL NODEPATHS PUB; do
    value=${!name}
    if [ -n "$value" ]; then
      if rm -f "$value"; then eval "$name=\"\""; else cleanup_error "$value"; fi
    fi
  done
  return "$CLEAN_RC"
}
remote_cleanup() {
  [ "$REMOTE_ARMED" = 1 ] || return 0
  if ssh "$HOST" "rm -rf ~/scratch/tweakcc-witness/$T.$RUNID"; then REMOTE_ARMED=0; return 0; fi
  cleanup_error "~/scratch/tweakcc-witness/$T.$RUNID"
  return 6
}
read_owner() {
  owner_line="unreadable"
  [ -r "$LOCK" ] || return 1
  IFS= read -r owner_line < "$LOCK"
}
release_lock() {
  [ "$LOCKED" = 1 ] || return 0
  exec 9>&- || return 6
  LOCKED=0
}
on_exit() {
  local rc=$?
  trap '' HUP INT QUIT TERM
  remote_cleanup || rc=6
  local_cleanup || rc=6
  if [ "$rc" != 0 ] && [ "$PUBLISHED" = 1 ]; then
    rm -f "$GITDIR/tweakcc-witness/$T" || { cleanup_error "$GITDIR/tweakcc-witness/$T"; rc=6; }
  fi
  # CONSTRAINT: fd-close failure does not invalidate passed checks; unpublishing after release could remove the next producer's witness.
  release_lock || { cleanup_error "$LOCK"; rc=6; }
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 131' QUIT; trap 'exit 143' TERM
TMP=$(mktemp -d "${TMPDIR:-/tmp}/tweakcc-witness.XXXXXX") || fail 'mktemp отказ'
RUNID="${TMP##*.}"
case "$RUNID" in ''|*[!A-Za-z0-9._-]*) fail "runid не вычислен: $RUNID" ;; esac
if [ "$seen_tree" = 1 ]; then
  T=$(git rev-parse --verify --quiet "$MODE_TREE^{tree}") || fail 'АРГУМЕНТЫ: --tree не называет дерево'
else
  # CONSTRAINT: write-tree can refresh cache-tree and must not take the user's index.lock.
  IDXSNAP=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-index.XXXXXX") || fail 'mktemp отказ'
  index=$(git rev-parse --git-path index) || fail 'git rev-parse --git-path index отказ'
  cp "$index" "$IDXSNAP" || fail 'копия индекса отказала'
  T=$(GIT_INDEX_FILE="$IDXSNAP" git write-tree) || fail 'git write-tree отказ'
fi
TREE_RE='^[0-9a-f]{40}([0-9a-f]{24})?$'
[[ $T =~ $TREE_RE ]] || fail "дерево не hex: $T"
LOCAL_HOST=$(uname -n) || fail 'uname -n отказ'
LOCK="$GITDIR/tweakcc-witness/$T.lock"
acquire_lock() {
  local attempt=0 flock_rc topq lockq
  while [ "$attempt" -lt 8 ]; do
    attempt=$((attempt+1))
    if ! exec 9>>"$LOCK"; then
      printf -v topq '%q' "$top"; printf -v lockq '%q' "$LOCK"
      printf 'run-witness: ОТКАЗ ЗАМОК_НЕЧИТАЕМ: %s; снять вручную: cd %s && rm -rf -- %s\n' "$LOCK" "$topq" "$lockq" >&2
      exit 8
    fi
    if [ -n "${TWEAKCC_WITNESS_LOCK_TEST_HOOK:-}" ]; then
      "$BASH" "$TWEAKCC_WITNESS_LOCK_TEST_HOOK" "$LOCK" || fail 'шов замка отказал'
    fi
    perl -e '
    use Fcntl qw(:flock);
    open(my $f, ">&=", 9) or exit 2;
    flock($f, LOCK_EX|LOCK_NB) or exit(($!{EWOULDBLOCK} || $!{EAGAIN}) ? 1 : 2);
    my @fd = stat($f); my @path = stat($ARGV[0]);
    exit 2 unless @fd;
    exit 3 unless @path && $fd[0] == $path[0] && $fd[1] == $path[1];
    truncate($f, 0) or exit 2;
    my $owner = "pid=$ARGV[1] host=$ARGV[2] runid=$ARGV[3]\n";
    my $written = syswrite($f, $owner);
    exit 2 unless defined($written) && $written == length($owner);
    ' "$LOCK" "$$" "$LOCAL_HOST" "$RUNID"
    flock_rc=$?
    case "$flock_rc" in
      0) LOCKED=1; return 0 ;;
      1)
        read_owner || :
        printf 'run-witness: ОТКАЗ ЗАМОК_ЗАНЯТ: %s owner=%s (owner= последний записавший прогон; замок может держать унаследовавший fd 9 потомок и после смерти владельца; путь вручную не снимать)\n' "$LOCK" "$owner_line" >&2
        exit 8 ;;
      3) exec 9>&- || fail 'ПРИБОР_НЕДОСТУПЕН: закрытие fd 9 замка'; continue ;;
      *) fail 'ПРИБОР_НЕДОСТУПЕН: flock' ;;
    esac
  done
  printf 'run-witness: ОТКАЗ ЗАМОК_ГОНКА: %s attempts=%s\n' "$LOCK" "$attempt" >&2
  exit 8
}
acquire_lock
rm -f "$GITDIR/tweakcc-witness/$T" || fail 'не удалён прошлый свидетель'
FL=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-files.XXXXXX") || fail 'mktemp отказ'
MSL=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-status.XXXXXX") || fail 'mktemp отказ'
EMPTY_TREE=4b825dc642cb6eb9a0f24d1c2b35d7b06f080e9
if [ "$seen_tree" = 1 ]; then
  base="$EMPTY_TREE"
  if git rev-parse -q --verify HEAD >/dev/null; then base=HEAD; fi
  git diff-tree -r -M -z --name-status "$base" "$T" > "$MSL" || fail 'git diff-tree --name-status отказ'
  git diff-tree -r -M -z --name-only "$base" "$T" > "$FL" || fail 'git diff-tree --name-only отказ'
else
  if git rev-parse -q --verify HEAD >/dev/null; then
    GIT_INDEX_FILE="$IDXSNAP" git diff --cached -M -z --name-status HEAD > "$MSL" || fail 'git diff --cached --name-status отказ'
    GIT_INDEX_FILE="$IDXSNAP" git diff --cached -M -z --name-only HEAD > "$FL" || fail 'git diff --cached --name-only отказ'
  else
    GIT_INDEX_FILE="$IDXSNAP" git ls-files -z > "$FL" || fail 'git ls-files отказ'
    while IFS= read -r -d '' f; do printf 'A\0%s\0' "$f"; done < "$FL" > "$MSL" || fail 'список первого коммита отказал'
  fi
fi
witness_status_mode "$MSL"
MODE="$needed"
witness_files "$FL"
if [ "$seen_files" = 1 ]; then
  F="$MODE_FILES"
  case "$F" in *$'\n'*|,*|*,|*,,*) fail 'ФАЙЛЫ: неверный транспорт списка' ;; esac
  rest="$F"
  while [ -n "$rest" ]; do
    encoded="${rest%%,*}"; if [ "$encoded" = "$rest" ]; then rest=""; else rest="${rest#*,}"; fi
    f=$(witness_decode "$encoded"; printf '.') || fail 'ФАЙЛЫ: декодирование отказало'; f=${f%.}
    [ "$(witness_encode "$f")" = "$encoded" ] || fail 'ФАЙЛЫ: неканоничная кодировка'
  done
fi
physical_path() {
  local rest="$1" norm="" comp candidate target depth=0
  case "$rest" in /*) ;; *) return 1 ;; esac
  while [ -n "$rest" ]; do
    rest="${rest#/}"; comp="${rest%%/*}"
    if [ "$rest" = "$comp" ]; then rest=""; else rest="${rest#*/}"; fi
    case "$comp" in
      ''|.) continue ;;
      ..) norm="${norm%/*}"; continue ;;
    esac
    candidate="$norm/$comp"
    if [ -L "$candidate" ]; then
      depth=$((depth+1)); [ "$depth" -le 40 ] || return 1
      target=$(readlink "$candidate" && printf '.') || return 2; target=${target%$'\n'.}
      case "$target" in /*) norm="" ;; esac
      rest="$target${rest:+/$rest}"
    else norm="$candidate"; fi
  done
  printf '%s' "${norm:-/}"
}
resolve_under_root() {
  local root p
  root=$(physical_path "$1" && printf '.') || return 1; root=${root%.}
  p=$(physical_path "$2" && printf '.') || return 1; p=${p%.}
  case "$p" in "$root"|"${root%/}/"*) return 0 ;; esac
  return 1
}
# --- снимок дерева T -------------------------------------------------------------
TLS=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-ls.XXXXXX") || fail 'mktemp отказ'
THP=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-paths.XXXXXX") || fail 'mktemp отказ'
TMPIDX=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-idx.XXXXXX") || fail 'mktemp отказ'
git ls-tree -r -z "$T" > "$TLS" || fail 'git ls-tree отказ'
GIT_INDEX_FILE="$TMPIDX" git read-tree "$T" || fail 'git read-tree отказ'
GIT_INDEX_FILE="$TMPIDX" git -c core.autocrlf=false -c core.eol=lf -c core.symlinks=true checkout-index --all --prefix="$TMP/" || fail 'git checkout-index отказ'
TAB=$'\t'; blob_n=0
while IFS= read -r -d '' ent; do
  meta="${ent%%"$TAB"*}"; path="${ent#*"$TAB"}"; mode="${meta%% *}"; oid="${meta##* }"
  case "$path" in node_modules|node_modules/*) fail "TRACKED_NODE_MODULES: дерево отслеживает $path" ;; esac
  case "$mode" in
    160000) fail "СНИМОК: подмодуль $path" ;;
    120000)
      wanted=$(git cat-file blob "$oid" && printf '.') || fail 'git cat-file отказ'; wanted=${wanted%.}
      actual=$(readlink "$TMP/$path" && printf '.') || fail 'readlink отказ'; actual=${actual%$'\n'.}
      [ "$wanted" = "$actual" ] || fail "СНИМОК: симлинк разошёлся: $path"
      ;;
    100644|100755)
      actual=$(git hash-object --no-filters -- "$TMP/$path") || fail 'СНИМОК: hash-object отказ'
      [ "$actual" = "$oid" ] || fail "СНИМОК: материализация разошлась: $path"
      printf '%s\0' "$path" >> "$THP" || fail 'СНИМОК: список обычных файлов отказал'
      ;;
    *) fail "СНИМОК: неизвестный режим $mode" ;;
  esac
  blob_n=$((blob_n+1))
done < "$TLS" || fail 'СНИМОК: список дерева не читается'
snap_n=$(find "$TMP" ! -type d -print0 | tr -cd '\000' | wc -c | tr -d ' ') || fail 'СНИМОК: счёт файлов отказал'
[ "$snap_n" = "$blob_n" ] || fail 'СНИМОК: число файлов разошлось'
SLF=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-slinks.XXXXXX") || fail 'mktemp отказ'
find "$TMP" -type l -print0 > "$SLF" || fail 'СНИМОК: find симлинков отказ'
while IFS= read -r -d '' lk; do resolve_under_root "$TMP" "$lk" || fail "СНИМОК: SYMLINK_ESCAPE: $lk"; done < "$SLF" || fail 'СНИМОК: список симлинков не читается'
[ -f "$TMP/pnpm-lock.yaml" ] && [ -f "$TMP/package.json" ] || fail 'ЗАВИСИМОСТИ: обязательного манифеста нет'
KEYIN=""; MANPRE=""
for m in $WITNESS_MANIFESTS; do
  if [ -f "$TMP/$m" ]; then
    mh=$($HASHCMD < "$TMP/$m") || fail "ЗАВИСИМОСТИ: hash $m отказ"; mh=${mh%% *}; MANPRE="$MANPRE $m"
  else mh=ABSENT; fi
  KEYIN="$KEYIN$m $mh
"
done
sha=$(printf '%s' "$KEYIN" | $HASHCMD) || fail 'ЗАВИСИМОСТИ: ключ отказал'; sha=${sha%% *}
case "$sha" in ''|*[!0-9a-f]*) fail 'ЗАВИСИМОСТИ: ключ не hex' ;; esac
MT=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-man.XXXXXX") || fail 'mktemp отказ'
# CONSTRAINT: dereference manifests so delivered bytes equal the bytes hashed above.
tar -h -czf "$MT" -C "$TMP" $MANPRE || fail 'УПАКОВКА: tar манифестов отказ'
B64=$(base64 < "$MT") || fail 'УПАКОВКА: base64 отказ'
FILES64=$(base64 < "$THP") || fail 'УПАКОВКА: base64 списка отказ'
NODEPATHS=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-nodepaths.XXXXXX") || fail 'mktemp отказ'
# CONSTRAINT: ESLint and Vitest receive only src/-rooted paths, so filenames cannot become leading-dash options.
ESLQ=""; PREQ=""; VITQ=""; rest="$F"
while [ -n "$rest" ]; do
  encoded="${rest%%,*}"; if [ "$encoded" = "$rest" ]; then rest=""; else rest="${rest#*,}"; fi
  f=$(witness_decode "$encoded"; printf '.'); f=${f%.}
  [ -f "$TMP/$f" ] && [ ! -L "$TMP/$f" ] || continue
  xq=$(printf '%q' "$f")
  case "$f" in src/*.ts|src/*.tsx) ESLQ="$ESLQ $xq" ;; esac
  case "$f" in src/*) VITQ="$VITQ $xq" ;; esac
  case "$f" in *.ts|*.tsx|*.json|*.md) PREQ="$PREQ $xq" ;; esac
  case "$f" in src/*|*.ts|*.tsx|*.json|*.md) printf '%s\0' "$f" >> "$NODEPATHS" || fail 'ФАЙЛЫ: список Node отказал' ;; esac
done
if [ "$MODE" = full ]; then NODE64="$FILES64"; else NODE64=$(base64 < "$NODEPATHS") || fail 'УПАКОВКА: base64 списка Node отказ'; fi
ssh "$HOST" "mkdir -p ~/scratch/tweakcc-witness ~/scratch/tweakcc-deps/$sha" || fail 'ssh mkdir отказ'
REMOTE_ARMED=1
rsync -a --no-xattrs --delete "$TMP/" "$HOST:scratch/tweakcc-witness/$T.$RUNID/" || fail 'rsync отказ'
LOG="$GITDIR/tweakcc-witness/$T.log"
# CONSTRAINT: unlink requires a fresh description's own nonblocking flock and matching inode; only ENOENT at open/path-stat, flock contention and inode mismatch are silent races; other name failures warn and continue, directory failures end the pass; names that are not *.lock, not regular files or younger than the age are filters, not failures.
find "$GITDIR/tweakcc-witness" -maxdepth 1 -type f ! -name '*.lock' -mtime +30 -delete
frc=$?; [ "$frc" = 0 ] || printf 'run-witness: ПРЕДУПРЕЖДЕНИЕ уборка по возрасту rc=%s\n' "$frc" >&2
perl -e '
use Fcntl qw(:flock);
opendir(my $dir, $ARGV[0]) or do {
  printf STDERR "run-witness: ПРЕДУПРЕЖДЕНИЕ уборка замков %s: открытие каталога: %s\n", $ARGV[0], "$!";
  exit 2;
};
my @names = readdir($dir);
closedir($dir) or do {
  printf STDERR "run-witness: ПРЕДУПРЕЖДЕНИЕ уборка замков %s: закрытие каталога: %s\n", $ARGV[0], "$!";
  exit 2;
};
my $cutoff = time() - 31 * 86400;
my $rc = 0;
my $warn = sub {
  my ($name, $step, $err) = @_;
  printf STDERR "run-witness: ПРЕДУПРЕЖДЕНИЕ уборка замка %s: %s: %s\n", $name, $step, $err;
  $rc = 2;
};
my $close = sub {
  my ($f, $name) = @_;
  if (!close($f)) { $warn->($name, "закрытие", "$!"); }
};
for my $name (@names) {
  next unless $name =~ /[.]lock$/;
  my $path = "$ARGV[0]/$name";
  my @old = stat($path);
  if (!@old) {
    $warn->($name, "состояние пути", "$!") unless $!{ENOENT};
    next;
  }
  next unless -f _ && $old[9] <= $cutoff;
  my $err = "";
  my $f;
  if (!open($f, "+<", $path)) {
    $err = "$!";
    next if $!{ENOENT};
    printf STDERR "run-witness: ПРЕДУПРЕЖДЕНИЕ уборка замка %s: открытие: %s\n", $name, $err;
    $rc = 2;
    next;
  }
  if (!flock($f, LOCK_EX|LOCK_NB)) {
    $err = "$!";
    if ($!{EWOULDBLOCK} || $!{EAGAIN}) { $close->($f, $name); next; }
    $warn->($name, "захват", $err);
    $close->($f, $name);
    next;
  }
  my @fd = stat($f);
  if (!@fd) {
    $warn->($name, "состояние fd", "$!");
    $close->($f, $name);
    next;
  }
  my @path = stat($path);
  if (!@path) {
    $warn->($name, "состояние пути после открытия", "$!") unless $!{ENOENT};
    $close->($f, $name);
    next;
  }
  if ($fd[0] != $path[0] || $fd[1] != $path[1]) { $close->($f, $name); next; }
  if (!unlink($path)) { $warn->($name, "удаление", "$!"); }
  $close->($f, $name);
}
exit $rc;
' "$GITDIR/tweakcc-witness"
frc=$?; [ "$frc" = 0 ] || printf 'run-witness: ПРЕДУПРЕЖДЕНИЕ уборка по возрасту rc=%s\n' "$frc" >&2
: > "$LOG" || fail 'журнал не создан'
RS0=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-resolve.XXXXXX") || fail 'mktemp отказ'
{
  declare -f physical_path resolve_under_root
  printf 'SNAP=~/scratch/tweakcc-witness/%s.%s\n' "$T" "$RUNID"
  cat <<'REMOTE_RESOLVE'
set -u
LFQ=$(mktemp) || { printf 'run-witness: mktemp отказ\n'; exit 11; }
trap 'rm -f "$LFQ" || exit 11' EXIT
find "$SNAP" -type l -print0 > "$LFQ" || { printf 'run-witness: find отказ\n'; exit 11; }
while IFS= read -r -d '' l; do
  resolve_under_root "$SNAP" "$l" || { printf 'run-witness: SYMLINK_ESCAPE: %s\n' "$l"; exit 11; }
done < "$LFQ" || { printf 'run-witness: чтение списка отказ\n'; exit 11; }
printf 'run-witness: симлинки снимка внутри корня\n'
REMOTE_RESOLVE
} > "$RS0" || fail 'скрипт резолвера не записан'
ssh "$HOST" bash -s < "$RS0" >> "$LOG" 2>&1
r0rc=$?
if [ "$r0rc" != 0 ]; then cat "$LOG"; fail "СНИМОК: удалённая проверка симлинков отказала (ssh rc=$r0rc)"; fi
IS=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-install.XXXXXX") || fail 'mktemp отказ'
{
  printf 'DEPS=~/scratch/tweakcc-deps/%s\nSNAP=~/scratch/tweakcc-witness/%s.%s\nKEY=%s\n' "$sha" "$T" "$RUNID" "$sha"
  printf 'MANIFESTS=%q\nB64=%q\n' "$WITNESS_MANIFESTS" "$B64"
  cat <<'INSTALL'
set -u
set -o pipefail
mkdir -p "$DEPS" || exit 7
exec 9>"$DEPS/.lock" || exit 12
flock 9 || exit 12
inst=""
if [ -f "$DEPS/.installed" ]; then inst=$(cat "$DEPS/.installed") || exit 9; fi
if [ "$inst" != "$KEY" ]; then
  for m in $MANIFESTS; do rm -f "$DEPS/$m" || exit 13; done
  printf '%s' "$B64" | base64 -d | gunzip | tar -xf - -C "$DEPS" || exit 10
  cd "$DEPS" || exit 7
  printf '%s\n' '+ pnpm install --frozen-lockfile'
  systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 pnpm install --frozen-lockfile
  rc=$?; printf 'run-witness: pnpm install rc=%s\n' "$rc"
  [ "$rc" = 0 ] || exit 5
  printf '%s\n' "$KEY" > "$DEPS/.installed" || exit 8
  inst=$(cat "$DEPS/.installed") || exit 9
  [ "$inst" = "$KEY" ] || exit 9
else printf 'run-witness: зависимости ключа %s уже стоят\n' "$KEY"; fi
ln -sfn "$DEPS/node_modules" "$SNAP/node_modules" || exit 8
INSTALL
} > "$IS" || fail 'скрипт установки не записан'
ssh "$HOST" bash -s < "$IS" >> "$LOG" 2>&1
irc=$?
if [ "$irc" != 0 ]; then cat "$LOG"; [ "$irc" != 5 ] || fail_run 'pnpm install отказал'; fail "УСТАНОВКА: ssh rc=$irc"; fi
RS=$(mktemp "${TMPDIR:-/tmp}/tweakcc-witness-run.XXXXXX") || fail 'mktemp отказ'
{
  printf 'cd ~/scratch/tweakcc-witness/%s.%s || exit 9\nMODE=%q\nFILES64=%q\nNODE64=%q\n' "$T" "$RUNID" "$MODE" "$FILES64" "$NODE64"
  cat <<'CHECKS'
set -u
printf 'run-witness: прогон начат\nrun-witness: режим прогона: %s\n' "$MODE"
printf '%s\n' '+ node UTF-8 filename roundtrip (full selector or related tool argv)'
systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 node --input-type=module - "$NODE64" <<'UTF8'
const bytes = Buffer.from(process.argv[2], 'base64');
let start = 0;
for (let end = 0; end < bytes.length; end++) {
  if (bytes[end] !== 0) continue;
  const raw = bytes.subarray(start, end);
  const name = raw.toString('utf8');
  if (!Buffer.from(name, 'utf8').equals(raw)) {
    const encoded = [...raw].map(b => b >= 0x21 && b <= 0x7e && b !== 0x25 && b !== 0x2c ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
    console.error('run-witness: ФАЙЛЫ_НЕ_UTF8: ' + encoded);
    process.exit(2);
  }
  start = end + 1;
}
UTF8
rc=$?; printf 'run-witness: filename UTF-8 rc=%s\n' "$rc"; [ "$rc" = 0 ] || exit 2
overall=0
check() {
  local name="$1" rc; shift
  printf '+ '; printf '%q ' "$@"; printf '\n'
  systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 "$@"
  rc=$?; printf 'run-witness: %s rc=%s\n' "$name" "$rc"
  [ "$rc" = 0 ] || overall=1
}
check tsc pnpm exec tsc --noEmit
CHECKS
  if [ "$MODE" = full ]; then
    cat <<'FULL'
check eslint pnpm exec eslint src
printf '%s\n' '+ node P6a snapshot glob selector -> pnpm exec prettier --check --ignore-unknown'
systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 node --input-type=module - "$FILES64" <<'JS'
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const cfg=JSON.parse(fs.readFileSync('package.json','utf8'))['lint-staged'];
if (!cfg || typeof cfg!=='object' || Array.isArray(cfg) || Object.keys(cfg).some(k=>!k)) {
  console.error('run-witness: LINT_STAGED_CONFIG: unrecognized glob object'); process.exit(2);
}
// CONSTRAINT: options match lint-staged 16.2.7 lib/generateTasks.js; globs come only from the snapshot manifest.
const require=createRequire(import.meta.resolve('lint-staged'));
const micromatch=require('micromatch');
const all=Buffer.from(process.argv[2],'base64').toString('utf8').split('\0').filter(Boolean);
const selected=new Set(all.filter(f=>f.startsWith('src/')));
for (const pattern of Object.keys(cfg)) {
  for (const f of micromatch(all,pattern,{cwd:process.cwd(),dot:true,matchBase:!pattern.includes('/'),posixSlashes:true,strictBrackets:true})) selected.add(f);
}
const files=all.filter(f=>selected.has(f));
const args=['exec','prettier','--check','--ignore-unknown','--',...files];
console.log('+ pnpm '+args.map(x=>JSON.stringify(x)).join(' '));
if (!files.length) {console.log('run-witness: prettier: empty supported set'); process.exit(0);}
const r=spawnSync('pnpm',args,{stdio:'inherit'});
if (r.error) console.error(r.error);
process.exit(r.status??2);
JS
rc=$?; printf 'run-witness: prettier rc=%s\n' "$rc"; [ "$rc" = 0 ] || overall=1
check vitest pnpm exec vitest run
FULL
  else
    if [ -n "$ESLQ" ]; then printf 'check eslint pnpm exec eslint%s\n' "$ESLQ"; else printf "printf 'run-witness: eslint: нет изменённых .ts/.tsx в src\\n'\n"; fi
    if [ -n "$PREQ" ]; then printf 'check prettier pnpm exec prettier --check --ignore-unknown --%s\n' "$PREQ"; else printf "printf 'run-witness: prettier: нет изменённых .ts/.tsx/.json/.md\\n'\n"; fi
    if [ -n "$VITQ" ]; then printf 'check vitest pnpm exec vitest related --run%s\n' "$VITQ"; else printf "printf 'vitest: нет изменённых src\\n'\n"; fi
  fi
  printf 'exit "$overall"\n'
} > "$RS" || fail 'скрипт проверок не записан'
ssh "$HOST" bash -s < "$RS" >> "$LOG" 2>&1
wrc=$?
if ! grep -Fqx 'run-witness: прогон начат' "$LOG"; then cat "$LOG"; fail "ПРОГОН_НЕ_НАЧАТ: ssh rc=$wrc"; fi
remote_cleanup || fail_cleanup "~/scratch/tweakcc-witness/$T.$RUNID"
printf 'run-witness: удалённый снимок %s.%s убран\n' "$T" "$RUNID"
local_cleanup || fail_cleanup 'локальные временные файлы не убраны'
if [ "$wrc" != 0 ]; then
  cat "$LOG"
  [ "$wrc" != 2 ] || fail "ФАЙЛЫ: проверяющему не передать имя (журнал: $LOG)"
  fail_run "проверки на $HOST rc=$wrc (журнал: $LOG)"
fi
PUB="$GITDIR/tweakcc-witness/.pub.$RUNID"
printf 'files=%s\nrc=0\nhost=%s\nmode=%s\n' "$F" "$HOST" "$MODE" > "$PUB" || fail 'свидетель не записан'
PUBLISHED=1
mv -f "$PUB" "$GITDIR/tweakcc-witness/$T" || fail 'свидетель не опубликован'
PUB=""
printf 'run-witness: свидетель %s files=%s mode=%s (журнал: %s)\n' "$T" "$F" "$MODE" "$LOG"
exit 0
