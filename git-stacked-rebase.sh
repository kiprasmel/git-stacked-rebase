#!/usr/bin/env bash

#SPLIT="@"
#git log --oneline --pretty=format:"'%H$SPLIT%d$SPLIT'" | cut -d"$SPLIT" -f2

#GIT_DIR="$HOME/.dotfiles/" 
#GIT_WORKTREE="$HOME"

GIT_DIR="$HOME/forkprojects/CodeshiftCommunity/.git/"
GIT_WORKTREE="$HOME/forkprojects/CodeshiftCommunity"

git() {
	/usr/bin/env git --git-dir="$GIT_DIR" --work-tree="$GIT_WORKTREE" $*
}

git log --oneline --pretty=format:'%H' > commits
git log --oneline --pretty=format:'%d' > branches
exit

node concat.js
