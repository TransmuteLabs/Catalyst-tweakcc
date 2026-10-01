#!/usr/bin/env bash
# Зубы двери коммита (.husky/pre-commit): хук только сверяет свидетель
# (файл <git-dir>/tweakcc-witness/<дерево>) и не запускает на этой машине
# ничего из инструментария проекта.
#
# CONSTRAINT: каждый красный случай обязан краснеть СВОЕЙ названной причиной
# и НЕ тянуть чужие -- иначе зуб зеленеет на чужой поломке.
#
# CONSTRAINT: живой репозиторий не читается и не пишется ни в одном случае:
# каждый случай строит свой git init в песочнице под ~/w523.
#
# CONSTRAINT: каждый зуб проверяется дважды: на настоящем хуке и настоящем
# составе дерева (зуб зелёный) и под СВОЕЙ мутацией -- текста хука или состава
# базового дерева (зуб краснеет: мутированный вариант ведёт себя неверно).
# Зуб, не краснеющий под своей мутацией, -- вакуумный, стенд красный.
#
# CONSTRAINT: заглушки ssh/rsync стоят на PATH каждого прогона двери и пишут
# маркер вызова: дверь не имеет права звать сеть и удалённые прогоны; каждый
# зелёный зуб требует ноль вызовов заглушек.
#
# CONSTRAINT: ожидаемое число зубов объявлено ЗДЕСЬ и больше нигде; расхождение
# фактического числа в ЛЮБУЮ сторону -- провал: тихо выпавший зуб неотличим от
# незаписанного.
#
# CONSTRAINT: стенд и дверь исполняются ОДНОЙ оболочкой -- той, что запустила
# стенд (bash 5.2 и bash 3.2.57 --posix), -- токены-детали из двух слов
# проходят списком через heredoc, не массивом: 3.2 массивы не обязан знать.
set -u

EXPECTED_TEETH=20

HERE="$(cd "$(dirname "$0")" && pwd)"
DOOR="$HERE/../.husky/pre-commit"
[ -f "$DOOR" ] || { printf 'стенд двери: нет хука %s\n' "$DOOR" >&2; exit 1; }

RULES="$HERE/witness-rules.sh"
SANDBOX="${WITNESS_TEST_SANDBOX:-/var/tmp}"
case "$SANDBOX/" in "$HOME/"*) printf 'stand: sandbox must be outside HOME\n' >&2; exit 2 ;; esac
mkdir -p "$SANDBOX" || { printf 'стенд двери: песочница %s не открылась\n' "$SANDBOX" >&2; exit 1; }
ROOT=$(mktemp -d "$SANDBOX/door-teeth.XXXXXX") || { printf 'стенд двери: mktemp отказ\n' >&2; exit 1; }
trap 'rm -rf "$ROOT"' EXIT

STUBBIN="$ROOT/stubs"
STUBMARK="$ROOT/stub-calls"
mkdir -p "$STUBBIN"
for t in ssh rsync; do
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s" >> "%s"\nexit 1\n' "$t" "$STUBMARK" > "$STUBBIN/$t"
  chmod +x "$STUBBIN/$t"
done

# CONSTRAINT: дверь зовёт только эти команды по имени; behavioural зуб даёт ей
# PATH ровно с ними (ссылки на настоящие бинари), любой другой вызов падает
# «command not found».
DOOR_TOOLS="git mktemp cp sed awk tail wc tr rm"
MINBIN="$ROOT/minbin"
ARGV_LOG="$ROOT/door-argv"
mkdir -p "$MINBIN"
for t in $DOOR_TOOLS; do
  tp=$(command -v "$t") || { printf 'стенд двери: нет команды %s\n' "$t" >&2; exit 1; }
  {
    printf '#!%s\n' "$BASH"
    printf 'record=$(printf '\''%%q '\'' %q "$@"); printf '\''%%s\\n'\'' "$record" >> "$DOOR_ARGV_LOG"\n' "$t"
    printf 'case %q" $*" in ${DOOR_FAIL_CMD:-__no_failure__}) exit 23 ;; esac\n' "$t"
    printf 'exec %q "$@"\n' "$tp"
  } > "$MINBIN/$t"
  chmod +x "$MINBIN/$t"
done

# CONSTRAINT: оболочка двери = оболочка стенда (и режим --posix вместе с ней).
POSIX_ON=$(set -o | sed -n 's/^posix[[:space:]]*on$/on/p')

PASS=0; FAIL=0; MUT_TOTAL=0; MUT_RED=0
ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }
mred() { printf 'мутация %s: КРАСНАЯ (%s)\n' "$1" "$2"; }

check_only() {   # <ожидаемые слова через пробел|пусто> <вывод>: пустая строка = изоляция чистая
  local exp="$1" out="$2" problem="" r
  while IFS= read -r r; do
    [ -n "$r" ] || continue
    case " $exp " in
      *" $r "*)
        case "$out" in *"$r"*) ;; *) problem="${problem}причина $r не названа; " ;; esac
        ;;
      *)
        case "$out" in *"$r"*) problem="${problem}тянется чужая $r; " ;; esac
        ;;
    esac
  done <<'TOKENS'
ПРИБОР_НЕДОСТУПЕН
ФАЙЛЫ_НЕКАНОНИЧНЫ
СВИДЕТЕЛЯ_НЕТ
отсутствует
симлинк
формат
rc≠0
чужой хост
другой список
режим
TOKENS
  printf '%s' "$problem"
}

mk_world() {   # <имя> -> путь репозитория с базовым коммитом
  local r="$ROOT/$1"
  mkdir -p "$r/src"
  printf 'export const a = 1\n' > "$r/src/a.ts"
  printf '# w\n' > "$r/README.md"
  git -C "$r" init -q
  git -C "$r" config user.email t@t
  git -C "$r" config user.name t
  git -C "$r" add -A
  git -C "$r" commit -qm base
  printf '%s' "$r"
}

run_door() {   # <репо> <хук> [минимальный PATH]: вывод двери, код возврата = код двери
  local r="$1" door="$2" minp="${3:-}"
  : > "$STUBMARK"; : > "$ARGV_LOG"
  mkdir -p "$r/scripts" "$r/home" "$r/tmp"
  [ -f "$r/scripts/witness-rules.sh" ] || cp "$RULES" "$r/scripts/witness-rules.sh"
  if [ "$minp" = min ]; then
    (cd "$r" && env HOME="$r/home" TMPDIR="$r/tmp" DOOR_ARGV_LOG="$ARGV_LOG" PATH="$MINBIN" "$BASH" ${POSIX_ON:+--posix} "$door" 2>&1)
  else
    (cd "$r" && env HOME="$r/home" TMPDIR="$r/tmp" PATH="$STUBBIN:$PATH" "$BASH" ${POSIX_ON:+--posix} "$door" 2>&1)
  fi
}

add_witness() {   # <репо> <files> <rc> <host> <mode>: свидетель пишется под текущий индекс
  # CONSTRAINT: путь .git литерой, не rev-parse: мир -- git init от самого
  # стенда, а rev-parse с -C даёт относительный .git от cwd стенда.
  local r="$1" files="$2" rc="$3" host="$4" mode="${5:-related}" T
  T=$(git -C "$r" write-tree)
  mkdir -p "$r/.git/tweakcc-witness"
  printf 'files=%s\nrc=%s\nhost=%s\nmode=%s\n' "$files" "$rc" "$host" "$mode" > "$r/.git/tweakcc-witness/$T"
}

mut_hook() {   # <sed-выражение>: путь мутированной копии хука на stdout
  sed "$1" "$DOOR" > "$ROOT/mut.sh" || return 1
  printf '%s' "$ROOT/mut.sh"
}

# CONSTRAINT: строка CMD= несёт ПЕЧАТАЕМУЮ команду производства (отказ обязан
# её назвать), а строки-триггеры needed="full" -- ТАБЛИЦУ ИМЁН конфигов,
# которые дверь обязана опознавать: это данные, не вызовы. Всё остальное --
# текст хука: токены инструментария, их абсолютные пути и косвенный вызов
# своего скрипта -- отказ.
static_clean() {   # <файл>: код 0 -- текст хука чист
  local body
  body=$(
    while IFS= read -r line || [ -n "$line" ]; do
      if [ "$line" = '  CMD="cd $TOPQ && bash scripts/run-witness.sh --tree $T --files $FQ"' ] ||
         [ "$line" = '  CMD="cd $TOPQ && bash scripts/run-witness.sh"' ] ||
         [ "$line" = 'source "$top/scripts/witness-rules.sh" || fail "ПРИБОР_НЕДОСТУПЕН: witness-rules.sh"' ]; then
        continue
      fi
      printf '%s\n' "$line"
    done < "$1"
  )
  if printf '%s\n' "$body" | grep -qE 'pnpm|tsc|vitest|prettier|eslint|lint-staged|npm|npx|yarn|bun|make|tsx|corepack|node_modules/[.]bin|(/|~|\$\{?HOME\}?)[^" ]*(npm|npx|yarn|bun|tsx|corepack|node_modules)'; then
    return 1
  fi
  if printf '%s\n' "$body" | grep -qE '(^|[;&|( ])(bash|sh|source) '; then
    return 1
  fi
  return 0
}

# --- 1. нет свидетеля -> отказ --------------------------------------------------
R=$(mk_world w1)
printf 'export const a = 2\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
T=$(git -C "$R" write-tree)
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ отсутствует" "$out")
M=$(mut_hook 's/w_fail="отсутствует: свидетель дерева \$T"/w_fail=""/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] \
   && [[ "$out" == *"bash scripts/run-witness.sh --tree $T --files src/a.ts"* ]] \
   && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "1) свидетель не произведён -- отказ с деревом, списком и точной командой; мутация ветки отсутствия красна"
  MUT_RED=$((MUT_RED+1)); mred 1 "мутированный хук ошибочно прошёл"
else
  bad "1) ждали отказ СВИДЕТЕЛЯ_НЕТ (отсутствует) и проход мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 2. свидетель чужого дерева -> отказ ----------------------------------------
R=$(mk_world w2)
printf 'export const a = 11\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
T1=$(git -C "$R" write-tree)
add_witness "$R" "src/a.ts" 0 usbox
printf 'export const a = 12\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
T2=$(git -C "$R" write-tree)
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ отсутствует" "$out")
M=$(mut_hook 's@WIT="\$gd/tweakcc-witness/\$T"@WIT=$(ls "$gd"/tweakcc-witness/* | sed -n 1p)@')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -n "$T1" ] && [ "$T1" != "$T2" ] && [ -f "$R/.git/tweakcc-witness/$T1" ] \
   && [ -z "$why" ] && [[ "$out" == *"bash scripts/run-witness.sh --tree $T2 --files src/a.ts"* ]] \
   && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "2) свидетель чужого дерева не принимается -- отказ называет текущее дерево; мутация привязки к дереву красна"
  MUT_RED=$((MUT_RED+1)); mred 2 "мутированный хук прочитал чужое дерево"
else
  bad "2) ждали отказ при живом свидетеле другого дерева и проход мутированного хука, получили rc=$rc mrc=$mrc T1=$T1 T2=$T2 $why[$out]"
fi

# --- 3. список файлов не совпал -> отказ ----------------------------------------
R=$(mk_world w3)
printf 'export const a = 3\n' > "$R/src/a.ts"
printf 'export const b = 1\n' > "$R/src/b.ts"
git -C "$R" add src/a.ts src/b.ts
T=$(git -C "$R" write-tree)
add_witness "$R" "src/a.ts" 0 usbox
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ другой список" "$out")
M=$(mut_hook 's/w_fail="другой список: свидетель дерева \$T под \${w_l1#files=}, индекс -- \$F"/w_fail=""/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] \
   && [[ "$out" == *"bash scripts/run-witness.sh --tree $T --files $(printf '%q' 'src/a.ts,src/b.ts')"* ]] \
   && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "3) урезанный список файлов свидетеля не принимается; мутация сверки списка красна"
  MUT_RED=$((MUT_RED+1)); mred 3 "мутированный хук принял чужой список"
else
  bad "3) ждали отказ «другой список» и проход мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 4. rc≠0 у свидетеля -> отказ -----------------------------------------------
R=$(mk_world w4)
printf 'export const a = 4\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
add_witness "$R" "src/a.ts" 1 usbox
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ rc≠0" "$out")
M=$(mut_hook 's/w_fail="rc≠0: свидетель дерева \$T"/w_fail=""/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "4) красный свидетель (rc=1) не принимается; мутация сверки rc красна"
  MUT_RED=$((MUT_RED+1)); mred 4 "мутированный хук принял красный свидетель"
else
  bad "4) ждали отказ «rc≠0» и проход мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 5. host≠usbox -> отказ -----------------------------------------------------
R=$(mk_world w5)
printf 'export const a = 5\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
add_witness "$R" "src/a.ts" 0 elsewhere
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ чужой хост" "$out")
M=$(mut_hook 's/w_fail="чужой хост: свидетель дерева \$T выдан \$w_host"/w_fail=""/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "5) свидетель чужой машины не принимается; мутация сверки хоста красна"
  MUT_RED=$((MUT_RED+1)); mred 5 "мутированный хук принял чужую машину"
else
  bad "5) ждали отказ «чужой хост» и проход мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 6. годный свидетель -> проход ----------------------------------------------
R=$(mk_world w6)
printf 'export const a = 6\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
T=$(git -C "$R" write-tree)
add_witness "$R" "src/a.ts" 0 usbox
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "" "$out")
M=$(mut_hook 's/^exit 0$/exit 1/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 0 )) && [ -z "$why" ] && [[ "$out" == *"прошло -- свидетель дерева $T"* ]] \
   && [ -z "$stubs" ] && (( mrc != 0 )); then
  ok "6) годный свидетель проходит, сеть не зовётся; мутация прохода красна"
  MUT_RED=$((MUT_RED+1)); mred 6 "мутированный хук отказал на годном свидетеле"
else
  bad "6) ждали проход по годному свидетелю и отказ мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 7. статическая проверка текста хука ----------------------------------------
if static_clean "$DOOR"; then
  base7=1
else
  base7=0
fi
all_caught=1
for tok in pnpm tsc vitest prettier eslint lint-staged npm npx yarn bun make tsx corepack node_modules/.bin /usr/local/bin/npm ~/bin/tsx '$HOME/.local/bin/corepack' node_modules/.bin/vitest; do
  cp "$DOOR" "$ROOT/mut7.sh"
  printf 'echo %s\n' "$tok" >> "$ROOT/mut7.sh"
  if static_clean "$ROOT/mut7.sh"; then
    all_caught=0
  fi
done
# CONSTRAINT: мутация (в) -- РЕАЛЬНЫЙ вызов до финального exit, не просто текст
sed 's/^exit 0$/npm run test\nexit 0/' "$DOOR" > "$ROOT/mut7c.sh"
if static_clean "$ROOT/mut7c.sh"; then
  all_caught=0
fi
MUT_TOTAL=$((MUT_TOTAL+1))
if [ "$base7" = 1 ] && [ "$all_caught" = 1 ]; then
  ok "7) текст хука не зовёт инструментарий, абсолютные пути и свои скрипты; каждая вставка ловится"
  MUT_RED=$((MUT_RED+1)); mred 7 "npm run test до exit 0 и все вставки-токены пойманы"
else
  bad "7) статическая проверка: чист настоящий хук=$base7, все вставки пойманы=$all_caught"
fi

# --- 8. свидетель-симлинк -> отказ ----------------------------------------------
R=$(mk_world w8)
printf 'export const a = 8\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/tweakcc-witness"
printf 'files=src/a.ts\nrc=0\nhost=usbox\nmode=related\n' > "$R/.git/tweakcc-witness/good"
ln -s good "$R/.git/tweakcc-witness/$T"
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ симлинк" "$out")
M=$(mut_hook 's/w_fail="симлинк: свидетель дерева \$T"/w_fail=""/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "8) свидетель-симлинк не принимается; мутация ветки симлинка красна"
  MUT_RED=$((MUT_RED+1)); mred 8 "мутированный хук пошёл по симлинку"
else
  bad "8) ждали отказ «симлинк» и проход мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 9. свидетель не четыре строки -> отказ -------------------------------------
R=$(mk_world w9)
printf 'export const a = 9\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/tweakcc-witness"
printf 'files=src/a.ts\nrc=0\nhost=usbox\nmode=related\nextra\n' > "$R/.git/tweakcc-witness/$T"
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ формат" "$out")
M=$(mut_hook 's/w_fail="формат: свидетель дерева \$T не четыре строки"/w_fail=""/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] && [[ "$out" == *"не четыре строки"* ]] \
   && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "9) пятая строка свидетеля не принимается; мутация счётчика строк красна"
  MUT_RED=$((MUT_RED+1)); mred 9 "мутированный хук проглотил пятую строку"
else
  bad "9) ждали отказ «не четыре строки» и проход мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 10. свидетель без завершающего перевода строки -> отказ ---------------------
R=$(mk_world w10)
printf 'export const a = 10\n' > "$R/src/a.ts"
git -C "$R" add src/a.ts
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/tweakcc-witness"
printf 'files=src/a.ts\nrc=0\nhost=usbox\nmode=related' > "$R/.git/tweakcc-witness/$T"
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ формат" "$out")
M=$(mut_hook 's/w_fail="формат: свидетель дерева \$T не кончается переводом строки"/w_fail=""/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] && [[ "$out" == *"не кончается переводом строки"* ]] \
   && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "10) незавершённая последняя строка свидетеля не принимается; мутация сверки хвоста красна"
  MUT_RED=$((MUT_RED+1)); mred 10 "мутированный хук принял файл без перевода строки"
else
  bad "10) ждали отказ «не кончается переводом строки» и проход мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 11. первый коммит: список из ls-files ----------------------------------------
R="$ROOT/w11"
mkdir -p "$R/src"
printf 'export const a = 1\n' > "$R/src/a.ts"
printf '# w\n' > "$R/README.md"
git -C "$R" init -q
git -C "$R" config user.email t@t
git -C "$R" config user.name t
git -C "$R" add -A
T=$(git -C "$R" write-tree)
add_witness "$R" "README.md,src/a.ts" 0 usbox
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "" "$out")
M=$(mut_hook 's/git ls-files -z > "\$FL"/git diff --cached --name-only -z HEAD > "$FL"/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 0 )) && [ -z "$why" ] && [[ "$out" == *"прошло -- свидетель дерева $T"* ]] \
   && [ -z "$stubs" ] && (( mrc != 0 )); then
  ok "11) первый коммит (нет HEAD) список берёт из ls-files; мутация ветки первого коммита красна"
  MUT_RED=$((MUT_RED+1)); mred 11 "мутированный хук сломал ветку без HEAD"
else
  bad "11) ждали проход по свидетелю ls-files и отказ мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# --- 12. запятая в пути -> отказ ФАЙЛЫ_НЕКАНОНИЧНЫ --------------------------------
R=$(mk_world w12)
printf 'export const c = 1\n' > "$R/src/a,b.ts"
git -C "$R" add "src/a,b.ts"
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "ФАЙЛЫ_НЕКАНОНИЧНЫ" "$out")
sed 's/fail "ФАЙЛЫ_НЕКАНОНИЧНЫ: запятая или перевод строки в пути: \$f"/:/' "$RULES" > "$R/scripts/witness-rules.sh"
M="$DOOR"
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] && [ -z "$stubs" ] \
   && [[ "$mout" != *"ФАЙЛЫ_НЕКАНОНИЧНЫ"* ]]; then
  ok "12) путь с запятой не канонизируется; мутация ветки отказа красна"
  MUT_RED=$((MUT_RED+1)); mred 12 "мутированный хук молча принял запятую в пути"
else
  bad "12) ждали отказ ФАЙЛЫ_НЕКАНОНИЧНЫ и молчаливый приём мутированным хуком, получили rc=$rc mrc=$mrc $why[$out]"
fi

# CONSTRAINT: pipeline children may log in any order; the exact argv multiset, including duplicates, is invariant.
emit_argv() { printf '%q ' "$@"; printf '\n'; }
expected_argv() {
  local r="$1" T="$2" parsed="$3" first="$4" cut="$5" cleanup="$6"
  {
    emit_argv git rev-parse --show-toplevel
    emit_argv mktemp FILES
    emit_argv mktemp STATUS
    emit_argv mktemp INDEX
    emit_argv git rev-parse --git-path index
    emit_argv cp .git/index INDEX
    emit_argv git write-tree
    emit_argv git rev-parse -q --verify HEAD
    if [ "$first" = 1 ]; then
      emit_argv git ls-files -z
    else
      emit_argv git diff --cached -M -z --name-only HEAD
      emit_argv git diff --cached -M -z --name-status HEAD
    fi
    emit_argv git rev-parse --git-dir
    if [ "$parsed" = 1 ]; then
      local p=".git/tweakcc-witness/$T" n
      for n in 1 2 3 4; do emit_argv sed -n "${n}p" "$p"; done
      emit_argv awk 'END{print NR}' "$p"
      emit_argv tail -c 1 "$p"
      emit_argv wc -l
      emit_argv tr -d ' '
    fi
  } > "$ROOT/expected-prefix"
  if [ "$cut" = 0 ]; then cat "$ROOT/expected-prefix"; else sed -n "1,${cut}p" "$ROOT/expected-prefix"; fi
  local tmp
  for tmp in $cleanup; do emit_argv rm -f "$tmp"; done
}
check_argv() {
  local r="$1" T="$2" parsed="$3" first="$4" cut="${5:-0}" cleanup="${6-FILES STATUS INDEX}"
  expected_argv "$r" "$T" "$parsed" "$first" "$cut" "$cleanup" | sed 's/ $//' | sort > "$ROOT/expected-argv"
  sed -E 's@[^ ]*/tweakcc-door-files\.[^ ]*@FILES@g; s@[^ ]*/tweakcc-door-status\.[^ ]*@STATUS@g; s@[^ ]*/tweakcc-door-index\.[^ ]*@INDEX@g; s/ $//' "$ARGV_LOG" | sort > "$ROOT/actual-argv"
  if ! diff -u "$ROOT/expected-argv" "$ROOT/actual-argv"; then return 1; fi
}
path_branches() {
  local hook="$1" label="$2" branch r T out rc parsed first wanted token p cut cleanup
  for branch in success missing symlink count no-lf files-prefix rc host-prefix host mode-prefix files mode first canonical top-fail rules-fail files-tool status-tool diff-files diff-status index-tool index-path copy-tool tree-tool gitdir-tool cleanup-tool; do
    r=$(mk_world "path-$label-$branch")
    printf 'export const a = 13\n' > "$r/src/a.ts"; git -C "$r" add src/a.ts
    T=$(git -C "$r" write-tree); p="$r/.git/tweakcc-witness/$T"
    add_witness "$r" src/a.ts 0 usbox
    parsed=1; first=0; wanted=1; token=СВИДЕТЕЛЯ_НЕТ; cut=0; cleanup='FILES STATUS INDEX'
    unset DOOR_FAIL_CMD
    case "$branch" in
      success) wanted=0; token='прошло -- свидетель' ;;
      missing) rm -f "$p"; parsed=0 ;;
      symlink) mv "$p" "$p.good"; ln -s "$T.good" "$p"; parsed=0 ;;
      count) printf 'extra\n' >> "$p" ;;
      no-lf) printf 'files=src/a.ts\nrc=0\nhost=usbox\nmode=related' > "$p" ;;
      files-prefix) sed -i 's/^files=/wrong=/' "$p" ;;
      rc) sed -i 's/^rc=0$/rc=1/' "$p" ;;
      host-prefix) sed -i 's/^host=/wrong=/' "$p" ;;
      host) sed -i 's/^host=usbox$/host=other/' "$p" ;;
      mode-prefix) sed -i 's/^mode=related$/mode=other/' "$p" ;;
      files) sed -i 's@^files=.*@files=other@' "$p" ;;
      mode) printf '{}\n' > "$r/.prettierrc"; git -C "$r" add .prettierrc; T=$(git -C "$r" write-tree); add_witness "$r" .prettierrc,src/a.ts 0 usbox ;;
      first) rm -f "$r/.git/refs/heads/$(git -C "$r" branch --show-current)"; first=1; wanted=0; token='прошло -- свидетель'; add_witness "$r" README.md,src/a.ts 0 usbox ;;
      canonical) printf x > "$r/src/new,odd.ts"; git -C "$r" add src; parsed=0; cut=10; cleanup='FILES STATUS INDEX'; token=ФАЙЛЫ_НЕКАНОНИЧНЫ ;;
      top-fail) export DOOR_FAIL_CMD='git rev-parse --show-toplevel'; parsed=0; cut=1; cleanup=''; token=ПРИБОР_НЕДОСТУПЕН ;;
      rules-fail) mkdir -p "$r/scripts"; printf 'return 23\n' > "$r/scripts/witness-rules.sh"; parsed=0; cut=1; cleanup=''; token=ПРИБОР_НЕДОСТУПЕН ;;
      files-tool) export DOOR_FAIL_CMD="mktemp $r/tmp/tweakcc-door-files.XXXXXX"; parsed=0; cut=2; cleanup=''; token=ПРИБОР_НЕДОСТУПЕН ;;
      status-tool) export DOOR_FAIL_CMD="mktemp $r/tmp/tweakcc-door-status.XXXXXX"; parsed=0; cut=3; cleanup='FILES'; token=ПРИБОР_НЕДОСТУПЕН ;;
      diff-files) export DOOR_FAIL_CMD='git diff --cached -M -z --name-only HEAD'; parsed=0; cut=9; token=ПРИБОР_НЕДОСТУПЕН ;;
      diff-status) export DOOR_FAIL_CMD='git diff --cached -M -z --name-status HEAD'; parsed=0; cut=10; token=ПРИБОР_НЕДОСТУПЕН ;;
      index-tool) export DOOR_FAIL_CMD="mktemp $r/tmp/tweakcc-door-index.XXXXXX"; parsed=0; cut=4; cleanup='FILES STATUS'; token=ПРИБОР_НЕДОСТУПЕН ;;
      index-path) export DOOR_FAIL_CMD='git rev-parse --git-path index'; parsed=0; cut=5; token=ПРИБОР_НЕДОСТУПЕН ;;
      copy-tool) export DOOR_FAIL_CMD="cp .git/index $r/tmp/tweakcc-door-index.*"; parsed=0; cut=6; token=ПРИБОР_НЕДОСТУПЕН ;;
      tree-tool) export DOOR_FAIL_CMD='git write-tree'; parsed=0; cut=7; token=ПРИБОР_НЕДОСТУПЕН ;;
      gitdir-tool) export DOOR_FAIL_CMD='git rev-parse --git-dir'; parsed=0; cut=11; token=ПРИБОР_НЕДОСТУПЕН ;;
      cleanup-tool) export DOOR_FAIL_CMD="rm -f $r/tmp/tweakcc-door-files.*"; token=УБОРКА ;;
    esac
    out=$(run_door "$r" "$hook" min); rc=$?
    unset DOOR_FAIL_CMD
    if [ "$rc" != "$wanted" ] || [[ "$out" != *"$token"* ]] || [[ "$out" == *'command not found'* ]] || ! check_argv "$r" "$T" "$parsed" "$first" "$cut" "$cleanup"; then
      printf 'PATH branch=%s rc=%s wanted=%s [%s]\n' "$branch" "$rc" "$wanted" "$out"; return 1
    fi
    printf 'PATH exact argv: %s\n' "$branch"
  done
}
if path_branches "$DOOR" base13; then base13=1; else base13=0; fi
sed 's/^exit 0$/npm run test\nexit 0/' "$DOOR" > "$ROOT/mut13a.sh"
if path_branches "$ROOT/mut13a.sh" mut13; then red13=0; else red13=1; fi
MUT_TOTAL=$((MUT_TOTAL+1))
if [ "$base13" = 1 ] && [ "$red13" = 1 ]; then
  ok '13) каждая ветка: точный argv, git-подкоманды и минимальный PATH'; MUT_RED=$((MUT_RED+1)); mred 13 'лишний вызов пойман'
else bad "13) PATH base=$base13 red=$red13"; fi

# --- 14. печатаемая команда исполняется и производит принимаемый свидетель ---------
R=$(mk_world w14)
printf 'export const ab = 1\n' > "$R/src/a b.ts"
git -C "$R" add "src/a b.ts"
mkdir -p "$R/scripts"
cat > "$R/scripts/run-witness.sh" <<'REC'
#!/usr/bin/env bash
set -u
T=""; F=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tree) [ $# -ge 2 ] || exit 1; T="$2"; shift 2 ;;
    --files) [ $# -ge 2 ] || exit 1; F="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -z "$T" ]; then T=$(git write-tree) || exit 1; fi
if [ -z "$F" ]; then
  F=$(git diff --cached --name-only HEAD | tr '\n' ',')
  F=${F%,}
fi
gd=$(git rev-parse --git-dir)
mkdir -p "$gd/tweakcc-witness"
printf 'files=%s\nrc=0\nhost=usbox\nmode=full\n' "$F" > "$gd/tweakcc-witness/$T"
REC
out=$(run_door "$R" "$DOOR"); rc=$?
cmd=${out#*произвести: }
why=$(check_only "СВИДЕТЕЛЯ_НЕТ отсутствует" "$out")
outc=$(cd "$R" && bash -c "$cmd"); crc=$?
out2=$(run_door "$R" "$DOOR"); rc2=$?
# пустой список: команда без --files
R2=$(mk_world w14e)
mkdir -p "$R2/scripts"
cp "$R/scripts/run-witness.sh" "$R2/scripts/run-witness.sh"
oute=$(run_door "$R2" "$DOOR"); rce=$?
cmde=${oute#*произвести: }
case "$cmde" in
  *--files*) bare=0 ;;
  *) bare=1 ;;
esac
outce=$(cd "$R2" && bash -c "$cmde"); crce=$?
out2e=$(run_door "$R2" "$DOOR"); rc2e=$?
M=$(mut_hook "s/printf '%q'/printf %s/")
TW=$(git -C "$R" write-tree)
rm -f "$R/.git/tweakcc-witness/$TW"
mout=$(run_door "$R" "$M"); mrc=$?
mcmd=${mout#*произвести: }
moutc=$(cd "$R" && bash -c "$mcmd"); mcrc=$?
mout2=$(run_door "$R" "$M"); mrc2=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] && (( crc == 0 )) && (( rc2 == 0 )) \
   && [[ "$out2" == *"прошло -- свидетель дерева"* ]] \
   && [ "$bare" = 1 ] && (( rce == 1 )) && (( crce == 0 )) && (( rc2e == 0 )) \
   && (( mcrc == 0 )) && (( mrc2 != 0 )); then
  ok "14) напечатанная команда (с пробелом в имени и пустым списком) производится и принимается; коды по источникам: отказ двери пустого списка rce=$rce, исполнение мутированной команды mcrc=$mcrc; мутация %q красна"
  MUT_RED=$((MUT_RED+1)); mred 14 "без экранирования пробел разорвал команду"
else
  bad "14) round-trip: rc=$rc crc=$crc rc2=$rc2 bare=$bare rce=$rce crce=$crce rc2e=$rc2e mcrc=$mcrc mrc2=$mrc2 [$out][$cmd][$out2e]"
fi

# --- 15. режим: related-свидетель при требуемом full -> отказ ----------------------
R=$(mk_world w15)
printf '{}\n' > "$R/.prettierrc"
git -C "$R" add .prettierrc
T=$(git -C "$R" write-tree)
add_witness "$R" ".prettierrc" 0 usbox related
out=$(run_door "$R" "$DOOR"); rc=$?
stubs=$(cat "$STUBMARK")
why=$(check_only "СВИДЕТЕЛЯ_НЕТ режим" "$out")
M=$(mut_hook 's/w_fail="режим: свидетель дерева \$T mode=related, изменение требует full"/w_fail=""/')
mout=$(run_door "$R" "$M"); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] && [[ "$out" == *"требует full"* ]] \
   && [ -z "$stubs" ] && (( mrc == 0 )); then
  ok "15) related-свидетель при правке конфига не принимается; мутация сверки режима красна"
  MUT_RED=$((MUT_RED+1)); mred 15 "мутированный хук принял related вместо full"
else
  bad "15) ждали отказ «режим» и проход мутированного хука, получили rc=$rc mrc=$mrc $why[$out]"
fi

# CONSTRAINT: refusal branches must not hide composed calls; allowlisted git still has an exact subcommand contract.
for key in refusal-composed suffix-allowlisted git-remote; do
  case "$key" in
    refusal-composed) sed '/^if \[ -n "\$w_fail" \]; then$/a\  x=n; ${x}pm run test' "$DOOR" > "$ROOT/$key.sh" ;;
    suffix-allowlisted) sed '/^witness_status_mode/i\case x in\n  *) git remote -v; needed="full" ;;\nesac' "$DOOR" > "$ROOT/$key.sh" ;;
    git-remote) sed '/^exit 0$/i\git remote -v' "$DOOR" > "$ROOT/$key.sh" ;;
  esac
  MUT_TOTAL=$((MUT_TOTAL+1))
  if [ "$base13" = 1 ] && ! path_branches "$ROOT/$key.sh" "$key"; then
    ok "$key: extra execution rejected by exact argv/branch contract"
    MUT_RED=$((MUT_RED+1)); mred "$key" 'P9 named mutation caught'
  else bad "$key: mutation not caught"; fi
done

R=$(mk_world w19)
printf 'export const a = 19\n' > "$R/src/a.ts"; git -C "$R" add src/a.ts
add_witness "$R" src/a.ts 0 usbox
mkdir -p "$R/scripts" "$R/home" "$R/tmp" || exit 2
cp "$RULES" "$R/scripts/witness-rules.sh" || exit 2
NOAWK="$ROOT/noawk"; mkdir -p "$NOAWK"
for t in $DOOR_TOOLS; do
  [ "$t" != awk ] || continue
  tp=$(command -v "$t") || exit 2
  ln -s "$tp" "$NOAWK/$t" || exit 2
done
missing_awk() {
  (cd "$R" && env HOME="$R/home" TMPDIR="$R/tmp" PATH="$NOAWK" "$BASH" ${POSIX_ON:+--posix} "$1")
}
out=$(missing_awk "$DOOR" 2>&1); rc=$?
M=$(mut_hook '/^for tool in sed awk tail wc tr; do$/,/^done$/d')
mout=$(missing_awk "$M" 2>&1); mrc=$?
MUT_TOTAL=$((MUT_TOTAL+1))
if [ "$rc" = 1 ] && [[ "$out" == *'ПРИБОР_НЕДОСТУПЕН: awk'* ]] && [[ "$mout" != *'ПРИБОР_НЕДОСТУПЕН: awk'* ]]; then
  ok 'missing-awk: absent tool has its named refusal'; MUT_RED=$((MUT_RED+1)); mred missing-awk 'tool guard removed'
else
  bad "missing-awk: rc=$rc mrc=$mrc [$out] [$mout]"
fi

# --- 20. коммит в свежем worktree исполняет дверь без pnpm install ------------------
# CONSTRAINT: предмет этого зуба -- СОСТАВ базового дерева, не текст хука:
# core.hooksPath резолвится от корня текущего worktree, и дверь в нём живёт
# только потому, что .husky/_ трекается в репозитории. Мутация -- базовый
# коммит без .husky/_: git молча пропускает хук, коммит обязан пройти тихо.
mk_door_world() {   # <имя> <состав: tracked|no-underscore> -> путь песочницы с базовым коммитом
  local r="$ROOT/$1" keep="$2"
  mkdir -p "$r/src" "$r/scripts" "$r/home" "$r/tmp" "$r/.husky/_"
  printf 'export const a = 1\n' > "$r/src/a.ts"
  printf '# w\n' > "$r/README.md"
  cp "$RULES" "$r/scripts/witness-rules.sh"
  cp "$DOOR" "$r/.husky/pre-commit"
  chmod 755 "$r/.husky/pre-commit"
  if [ "$keep" = tracked ]; then
    cp -p "$HERE"/../.husky/_/* "$r/.husky/_/"
    cp -p "$HERE"/../.husky/_/.gitignore "$r/.husky/_/"
  else
    rmdir "$r/.husky/_"
  fi
  git -C "$r" init -q
  git -C "$r" config user.email t@t
  git -C "$r" config user.name t
  git -C "$r" add -A
  # CONSTRAINT: .husky/_/.gitignore со строкой * глушит собственное содержимое --
  # в индекс его кладёт только -f, как и в живом репозитории.
  git -C "$r" add -f .husky
  # CONSTRAINT: hooksPath ставится ПОСЛЕ базового коммита: база не обязана
  # иметь свидетеля, дверь проверяет только коммиты поверх неё.
  git -C "$r" commit -qm base
  git -C "$r" config core.hooksPath .husky/_
  printf '%s' "$r"
}
run_wt_commit() {   # <репо>: коммит в свежем worktree; вывод на stdout, rc = код коммита
  local r="$1" wt="$1-wt"
  : > "$STUBMARK"
  (cd "$r" && env HOME="$r/home" TMPDIR="$r/tmp" PATH="$STUBBIN:$PATH" \
     git worktree add "$wt" -b wt >"$wt-add.log" 2>&1) || return 9
  printf 'export const a = 2\n' > "$wt/src/a.ts"
  git -C "$wt" add src/a.ts
  (cd "$wt" && env HOME="$r/home" TMPDIR="$r/tmp" PATH="$STUBBIN:$PATH" \
     git commit -m w 2>&1)
}
R=$(mk_door_world w20 tracked)
base20=$(git -C "$R" rev-parse HEAD)
out=$(run_wt_commit "$R"); rc=$?
stubs=$(cat "$STUBMARK")
head20=$(git -C "$R" rev-parse refs/heads/wt)
TWT=$(git -C "$ROOT/w20-wt" write-tree)
why=$(check_only "СВИДЕТЕЛЯ_НЕТ отсутствует" "$out")
M=$(mk_door_world w20m no-underscore)
mbase20=$(git -C "$M" rev-parse HEAD)
mout=$(run_wt_commit "$M"); mrc=$?
mstubs=$(cat "$STUBMARK")
mhead20=$(git -C "$M" rev-parse refs/heads/wt)
MUT_TOTAL=$((MUT_TOTAL+1))
if (( rc == 1 )) && [ -z "$why" ] \
   && [[ "$out" == *"дверь коммита: ОТКАЗ СВИДЕТЕЛЯ_НЕТ: отсутствует: свидетель дерева $TWT"* ]] \
   && [ "$head20" = "$base20" ] && [ -z "$stubs" ] \
   && (( mrc == 0 )) && [[ "$mout" != *"дверь коммита"* ]] && [[ "$mout" != *husky* ]] \
   && [ "$mhead20" != "$mbase20" ] && [ -z "$mstubs" ]; then
  ok "20) коммит в свежем worktree без pnpm install исполняет дверь: отказ называет дерево этого worktree; мутация состава красна"
  MUT_RED=$((MUT_RED+1)); mred 20 "без .husky/_ в базовом коммите git молча пропустил хук"
else
  bad "20) ждали отказ двери в свежем worktree и тихий проход без .husky/_, получили rc=$rc mrc=$mrc head=$head20 base=$base20 mhead=$mhead20 mbase=$mbase20 $why[$out][$mout]"
fi

# --- итог ---------------------------------------------------------------------------
if [ "$((PASS+FAIL))" -ne "$EXPECTED_TEETH" ] || [ "$MUT_TOTAL" -ne "$EXPECTED_TEETH" ]; then
  printf 'стенд двери: фактически прогнано зубов %s (мутаций %s), ожидалось %s -- ПРОВАЛ\n' \
    "$((PASS+FAIL))" "$MUT_TOTAL" "$EXPECTED_TEETH" >&2
  exit 1
fi
printf '%s passed, %s failed, expected %s\n' "$PASS" "$FAIL" "$EXPECTED_TEETH"
printf 'мутации: %s/%s красные\n' "$MUT_RED" "$MUT_TOTAL"
if [ "$FAIL" = 0 ] && [ "$MUT_RED" = "$MUT_TOTAL" ]; then
  exit 0
fi
exit 1
