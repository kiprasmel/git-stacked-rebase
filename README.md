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
