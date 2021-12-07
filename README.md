# git-stacked-rebase

stacked diffs in git, seamlessly.

why jump through branches manually, when we can extend `git rebase -i` instead?

a branch is just a reference to some commit (literally, it's a single-line file that contains a 40-character commit SHA -- check your `.git/refs/` folder). why not just work on your latest feature branch, rebase comfortably, and then have your tool automatically update the partial branches to make them point to the correct new commits?

from those partial branches, you can create pull requests. with this workflow, you get to comfortably iterate in a single branch; your teammates get the benefits of reviewing smaller PRs (when they're ready). win win. that's _literally_ all.

---

`git-stacked-rebase` is not specific to any host like github or gitlab. it's specific to `git` itself.

in the future, we could create host-specific adapters. they could be used to automate some simple tasks, such as changing the base branch of a pull request.

---

the mindset of `git-stacked-rebase` is important if you're trying to understand it / extend it / build on top of it. there are 2 things:

1. `git-stacked-rebase` (rather, `gitStackedRebase` (!)), is, first and foremost, a javascript library/module.
2. this library/module is `git`-first (i.e., it's core functionality is not specific to any git host). 

from the 2 above, we can reason that:

components, such as the CLI (`git-stacked-rebase`), or, in the future - the adapters for host-specific improvements, - are things that should be built _on top_ of the library's core, non within it.
i.e., we want to keep the core functionality `git`-specific, and if one wants to build a component that would require modifying the core to work for only that specific component (or for some components, but not git itself), then that's the wrong approach.


## Progress

follow [http://kiprasmel.github.io/notes/git-stacked-rebase.html](http://kiprasmel.github.io/notes/git-stacked-rebase.html)
