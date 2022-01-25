# git-stacked-rebase

stacked diffs in git, seamlessly.

why jump through branches manually, when we can extend `git rebase -i` instead?

a branch is just a reference to some commit (literally, it's a single-line file that contains a 40-character commit SHA -- check your `.git/refs/` folder). why not just work on your latest feature branch, rebase comfortably, and then have your tool automatically update the partial branches to make them point to the correct new commits?

from those partial branches, you can create pull requests. with this workflow, you get to comfortably iterate in a single branch; your teammates get the benefits of reviewing smaller PRs (when they're ready). win win. that's _literally_ all.

---

`git-stacked-rebase` is not specific to any host like github or gitlab. it's "specific" to `git` itself.

it's not only a CLI either - it's first and foremost a javascript library, and the CLI is just a tool that builds on top of the library.

in the future, we could create host-specific adapters. they could be used to automate some simple tasks, such as creating a pull request, or changing the base branch of a pull request, etc.

## Progress

follow [http://kiprasmel.github.io/notes/git-stacked-rebase.html](http://kiprasmel.github.io/notes/git-stacked-rebase.html)

## Setup

dependencies:

- [node.js](https://nodejs.org/en/)
- git
- something else i probably forgot

```sh
npm i -g git-stacked-rebase

# optional:
git config --global alias.stacked-rebase git-stacked-rebase
git config --global alias.rr             git-stacked-rebase
```

## Usage

```sh
cd repo/

# checkout your remote branches locally (until we automate it w/ a command?). 
# then, checkout to the latest one.
# then:

git-stacked-rebase --help
```
<!-- 
## What problems do we solve

whatever `git-stacked-rebase` is doing, you could do manually,

i.e. checking out separate branches, keeping them up to date -
constantly rebasing the first branch onto master, and subsequent branches
on the previous one, all while having to drop now-empty/duplicate commits.

but, it doesn't have to be like this.

<++>
-->

## how it works, the tricky parts, & things to be aware of

instead of rebasing one partial branch on top of another,
we always use the latest branch and rebase it onto the initial branch,
and then reset the partial branches to point to new commits.

the last part is the hardest, and likely still has many bugs yet unsolved.

the tricky part comes from the power of git-rebase.
as long as a rebase finishes without exiting, we are golden.
but, as soon as a user indicates that they want to do some further
operations, by e.g. changing a command from `pick` to `edit` or `break`,
then git-rebase, when it reaches that point, has to exit (!) to let the user
do whatever actions they want to do, and of course allows the user to continue
the rebase via `git rebase --continue`.

<!-- 
this ability to pause the execution of the rebase,
and then continue later on, is very powerful & useful,
and the fact that it makes our job harder is not a bad thing;
rather, it's a natural occurence <++>
-->

why this matters is because we need to recover the branches
to point to the new commits.

git, upon finishing (?) the rebase, writes out a file
inside `.git/rebase-{merge|apply}/` -- `rewritten-list`.
this file contains the rewritten list of commits - 
either `1 -> 1` mapping, or, if multiple commits got merged into 1
(e.g. `squash` / `fixup` / manually with `edit`, or similar),
`N -> 1` mapping (?).
it's very simple - old commit SHA, space, new commit SHA, newline.

again, this is how we understand the new positions that the branches
need to be poiting to.

and no, we cannot simply use the `git-rebase-todo` file (the one you edit
when launching `git rebase -i` / `git-stacked-rebase`),
because of commands like `break`, `edit`, etc., whom, again, allow you
to modify the history, and we cannot infer of what will happen
by simply using the `git-rebase-todo` file.

<!-- now, issue(s) come up when  -->
let's first do a scenario without the issue(s) that we'll describe soon -
you ran `git-stacked-rebase`, you did some `fixup`s, `squash`es, `reword`s,
etc. - stuff that _does not_ make git-rebase exit.

all went well, git-rebase wrote out the `rewritten-list` file,
we snagged it up with a `post-rewrite` script that we placed
inside `.git/hooks/`, we combined it with the now outdated
`git-rebase-todo` file (old SHAs etc.) to figure out where the
branch boundaries (partial branches) should end up at in the
new history, and we reset them successfully. all good and well.

now, the scenario w/ a potential issue (?) -- you did
all the same as above, but you also had an `edit` command,
and when git-rebase progressed to it, you `git reset HEAD~`
your commit and instead create 3 new commits, and then continued
& the rebase via `git rebase --continue`.

since `git-rebase` exited before it was done,
we, `git-stacked-rebase`, were __not__ able to reset the branches
to the new history, because of course, if git-rebase exits,
but the rebase is still in progress, we know you are _not_ done,
thus we exit as well.

so when you finish, your changes are applied to your latest branch,
__but__ the partial branches are now out of date.

what you need to do in this case is run `git-stacked-rebase <branch> --apply`,
which, in the 1st scenario, happened automatically.

__the real issue arises when you forget to do the `--apply` part in time__,
i.e. if you do any other history rewritting, including `git commit --amend`,
before you `--apply`ied, `git-stacked-rebase` can no longer (?) properly figure out
where the partial branches should point to, and you're stuck in having to do it
manually.

in the future, we might consider storing the list of partial branches
and if they end up gone, we could e.g. place them at the end of the
`git-rebase-todo` file the next time you invoke `git-stacked-rebase`,
thus you'd be able to drag them into their proper places yourself.
but until then, beware this issue exists (?).
