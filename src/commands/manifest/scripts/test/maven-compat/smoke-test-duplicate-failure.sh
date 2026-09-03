#!/usr/bin/env bash
# Regression guard: an unresolvable dependency shared by several reactor modules must be reported as
# what it is — a per-artifact resolution failure — and must never be reported as a module-level
# `graph` failure, which would claim the dependency graph itself could not be built.
#
# Every module inherits the same missing dependency and the same repository list, so every module's
# failure carries an identical message. The accumulator is a value-equality set shared across the
# whole reactor, so those identical failures collapse into one entry — and a fail-closed check that
# asks "did this module add anything?" by comparing set sizes concludes, wrongly, that the module
# reported nothing and invents a `graph` failure for it.
#
# Runs offline: the missing artifact is never looked for in a remote repository, so this needs no
# stub repo and never touches the network.
#
# Usage: smoke-test-duplicate-failure.sh <path-to-mvn> <path-to-extension-jar>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MVN="${1:?usage: smoke-test-duplicate-failure.sh <mvn> <extension-jar>}"
JAR="${2:?usage: smoke-test-duplicate-failure.sh <mvn> <extension-jar>}"
PROJECT="$HERE/duplicate-failure"
RECORDS="$PROJECT/records.tsv"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
M2="$SOCKET_COMPAT_CACHE/m2"

rm -rf "$M2/demo/missing" "$RECORDS"

echo "+ $("$MVN" -v 2>/dev/null | head -1) (duplicate failure)"
( cd "$PROJECT" && "$MVN" --batch-mode -q -o \
    "-Dmaven.ext.class.path=$JAR" \
    -Dcoana.task=socket-facts \
    -Dsocket.withFiles=true \
    "-Dmaven.repo.local=$M2" \
    "-Dsocket.recordsFile=$RECORDS" \
    validate )

python3 "$HERE/assert-no-invented-failures.py" "$RECORDS"
