#!/bin/sh

set -e

# sync 'nightly' with the current branch in remote (that has been pushed)
#
# we don't want the local version of the current branch,
# because if we haven't pushed new commits into remote yet
# (thru current branch), we don't want to push thru nightly either.
#
CURR_BRANCH_PUSHED="origin/$(git branch --show)"
git branch -f nightly "$CURR_BRANCH_PUSHED"

LOCAL_NIGHTLY="$(git rev-parse nightly)"
REMOTE_NIGHTLY="$(git rev-parse origin/nightly)"
if [ "$LOCAL_NIGHTLY" = "$REMOTE_NIGHTLY" ]; then
	printf "Already up-to-date, skipping push.\n"
else
	git push -f origin nightly
fi

# create a git hook for this repo
# that will auto-run this goodnight.sh script
# after a stacked-rebase is finished in this repo.
POST_STACKED_REBASE_HOOK_PATH=".git/hooks/post-stacked-rebase"

cat > "$POST_STACKED_REBASE_HOOK_PATH" <<'EOF'
#!/bin/sh

# DO NOT EDIT THIS FILE MANUALLY
# AUTO-GENERATED BY GIT-STACKED-REBASE's goodnight.sh script.

DIRNAME="$(dirname $0)"

GOODNIGHT_SCRIPT="$(realpath $DIRNAME/../../goodnight.sh)"

sh "$GOODNIGHT_SCRIPT"
EOF

chmod +x "$POST_STACKED_REBASE_HOOK_PATH"
