# git-stacked-rebase

stacked diffs in git, seamlessly.

<div align="center">
	<img src="Documentation/assets/git-rebase-todo.png"></img>
	<p>
		<code>git-stacked-rebase</code>
		is like <code>git rebase -i</code>,
		but it allows you to rebase stacked branches as well.
	</p>
</div>

previously, if you wanted to adopt a stacked branch workflow, you'd have to do a lot of manual work every time you'd update anything in your stack -- jump thru each branch, re-rebase it on top of the previous one, get rid of duplicate commits, resolve conflicts, try to remember what the next branch was, and repeat...

there must be a better way. and that's exactly how git-stacked-rebase came to be. 

a branch is just a reference to some commit (literally, it's a single-line file that contains a 40-character commit SHA -- check your `.git/refs/` folder). why not just work on your latest feature branch, rebase comfortably, and then have your tool automatically update the partial branches to make them point to the correct new commits?

from those partial branches, you can create pull requests. with this workflow, you get to comfortably iterate in a single branch; your teammates get the benefits of reviewing smaller PRs (when they're ready). win win. that's it.

---

`git-stacked-rebase` is not specific to any host like github or gitlab. it's "specific" to `git` itself.

it's not only a CLI either - it's written as a javascript library, with the CLI directly on top.
though, we're keeping our options open for a potential rewrite in C (read: we're designing it in a way
to make a rewrite in C possible w/o breaking changes to end users,
_if_ someone knowledgeable in git's core and C would want to take on this).

in general, the design goal has always been for the experience to feel as similar to git as possible.
and this is why i feel that it could eventually become part of core git.
(it wasn't a "goal" per se, it just felt like the right approach.)

nonetheless, there are other interesting things for us to explore, e.g.:
- creating host-specific adapters - they could be used to automate some simple tasks, such as creating a pull request, or changing the base branch of a pull request, etc.
- creating a browser extension to improve the experience of exploring stacked PRs.

## Progress

follow [http://kiprasmel.github.io/notes/git-stacked-rebase.html](http://kiprasmel.github.io/notes/git-stacked-rebase.html)

## Setup

dependencies:

- git
- a unix-like environment
- [node.js](https://nodejs.org/en/)
	- tested versions: 12 thru 18, except v18 on linux. [see details](https://github.com/kiprasmel/git-stacked-rebase/blob/refactor1/.github/workflows/test.yml).
		- note that after installing node, you can install version managers, e.g. `npm i -g n`, to easily change node's version.
- yarn (`npm i -g yarn`)

<!-- REMOVED because i'm dogfooding like never before. use nightly instead. -->
<!--
```sh
npm i -g git-stacked-rebase

# optional:
git config --global alias.rr             git-stacked-rebase
```
-->

once satisfied, run:

```sh
git clone https://github.com/kiprasmel/git-stacked-rebase
# or:  git clone git@github.com:kiprasmel/git-stacked-rebase.git

cd git-stacked-rebase

./nightly-setup-and-update.sh
```

[![nightly](https://img.shields.io/github/actions/workflow/status/kiprasmel/git-stacked-rebase/test.yml?label=nightly)](https://github.com/kiprasmel/git-stacked-rebase/actions/workflows/test.yml)

## Usage

```sh
$ git-stacked-rebase --help

git-stacked-rebase <branch>

    0. usually <branch> should be a remote one, e.g. 'origin/master'.
    1. will perform the interactive stacked rebase from HEAD to <branch>,
    2. but will not apply the changes to partial branches until --apply is used.


git-stacked-rebase [-a|--apply]

    3. will apply the changes to partial branches,
    4. but will not push any partial branches to a remote until --push is used.


git-stacked-rebase [-p|--push -f|--force]

    5. will push partial branches with --force (and extra safety).



non-positional args:

  --autosquash, --no-autosquash

      handles "fixup!", "squash!" -prefixed commits
      just like --autosquash for a regular rebase does.

      can be enabled by default with the 'rebase.autosquash' option.


  --git-dir <path/to/git/dir/>

    makes git-stacked-rebase begin operating inside the specified directory.


  -V|--version
  -h|--help

```
