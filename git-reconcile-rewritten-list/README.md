# git-reconcile-rewritten-list

extracted from [git-stacked-rebase](../).

after `git rebase`, `git commit --amend`, etc., especially multiple ones, the rewritten-list will not tell the full story.

`git-reconcile-rewritten-list` currently provides 2 methods:

- [setupPostRewriteHookFor](./postRewriteHook.ts)
	- to setup custom `post-rewrite` hook(s), so that the full story gets captured
- [combineRewrittenLists](./combineRewrittenLists.ts)
	- to "combine" the rewritten lists, or rather: for each rebase - to normalize it & it's amends
	 
there's some logic in [git-stacked-rebase](../), specifically `parseNewGoodCommands` & friends, yet to be extracted.
(if ever? since it's very related to git-stacked-rebase itself. not sure where the boundary is yet).

note that a proper solution for combining all rewritten lists is still yet to be implemented.
- [git-stacked-rebase](../) uses the `combinedRewrittenList`, which currently works by taking the last rewritten list.
- we might eventually discover that combining all rewritten lists as a single operation & only then processing them
  is actually not giving us the correct results: git-stacked-rebase needs to recover branches
  from the very first append into the `rewritten-list` file, up until it's called again to `--apply`.
  what could happen is that a user would make updates to branches in between their multiple regular rebases
  (without using git-stacked-rebase, which would itself `--apply` before doing a new rebase),
  - e.g. commit `A` gets rewritten to `A1` and later `A2`. branch `B` used to point to `A`,
	but gets changed by the user to `A1`.
	we'd need to point the branch to `A2`, but we have no knowledge of it being changed to `A1` --
	we only see that `A` went to `A2` when we combine the rewritten lists, 
	but we don't pick up anything about `A1`, and thus `B` gets lost.
	(that's been the whole point of combining so far. well, not for rebases, but for amends).
	- to fix this problem, instead of fully normalizing & only then resolving the rebase events,
	  which leaves us with only the 1st & last states,
	  we'd need to do the resolving in between each step of normalization, to make sure that no history is lost.
	  - but, again, we haven't tested yet if this problem actually occurs. though it probably does.
		my main testing ground is me myself dogfooding the tool, and i've never encountered such a situation
		(i'd have to intentionally try to get into it). so to test the hypothesis, need to create a test case for it first.
	  - perhaps this is why i wanted to & indeed did name this sub-project `reconcile` instead of `combine`.
