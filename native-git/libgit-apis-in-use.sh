#!/bin/sh

# how hard would be to get rid of libgit?
#
# 1. libgit2 project itself is kinda dead...
# - v much outdated from core git
# - many issues not fixed
# - updates not coming, even to the previously pretty up-to-date nodegit pkg
# - issues not being closed or even addressed, just dead vibes all around..
#
# 2. building is a chore, takes up almost 90MB,
#    breaks between node versions & needs re-build for each...
#

OUTDIR="/tmp/git-stacked-rebase"
OUTFILE="$OUTDIR/libgit2-api-counts"

mkdir -p "$OUTDIR"

# sorting:
# https://stackoverflow.com/a/15984450/9285308

rg "Git\.\w+" -o --no-line-number --no-filename | sort | uniq -c | sort -bgr > "$OUTFILE"
printf "$(cat $OUTFILE)\n"

TOTAL_COUNT="$(cat $OUTFILE | awk '{SUM+=$1}END{print SUM}')"
printf "\ntotal: $TOTAL_COUNT\n\n"
