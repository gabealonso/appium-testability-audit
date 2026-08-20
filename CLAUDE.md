# CLAUDE.md

Guide for working in this repository. It audits an **Appium page source** for
testability: it ranks every element by how stable a locator you can write for it, and
reports what only a positional XPath can reach.

> **Philosophy:** zero runtime dependencies. Node runs the TypeScript directly, `node:test`
> runs the tests, and there is no HTTP client, no XML library and no framework. Do not add
> a dependency without a reason that survives being questioned.

---

## Stack and commands

- **TypeScript**, ESM, executed **directly by Node** (type stripping — no build step, no
  `tsx`, no `ts-node`).
- **`node:test`** + **`node:assert/strict`** for the tests.
- `typescript` and `@types/node` are the only entries in `devDependencies`, and they are
  there for `tsc --noEmit`. Nothing ships as a runtime dependency.

```bash
npm test        # node --test tests/*.spec.ts
npm run typecheck
node src/cli.ts fixtures/compose-list.screen.json
```

Node **23 or newer** is required, because that is where running `.ts` directly landed.
Three consequences that bite immediately:

- Local imports use the **real `.ts` extension**: `import { rankElement } from "./rank.ts";`
  Not `.js`, which is what a bundler-oriented setup would want.
- `erasableSyntaxOnly` is on: no `enum`, no `namespace`, no parameter properties. Anything
  that would need to *emit* code rather than be erased is banned.
- `noUncheckedIndexedAccess` is on, so `array[0]` is `T | undefined`. Handle it; do not
  reach for `!`.

---

## What the tool actually claims

The whole point is in `src/rank.ts`, and it is one opinion: **a locator is only as good as
the worst thing about it.** Two questions, in order.

1. **Is the attribute one the app controls?** A `resource-id` is set by a developer on
   purpose. A position in the tree is set by whoever last touched the layout.
2. **Is the value unique on this screen?** This is the half that tools usually skip. A
   `RecyclerView` whose twelve rows share `resource-id=".../row_title"` has twelve
   perfectly stable-looking locators that all match twelve elements. That is not stable,
   it is **ambiguous**, and the fix is a different one — scope to the row, or give the
   rows distinguishing content descriptions.

So the ladder is: **the first candidate that is unique wins.** A unique `content-desc`
beats a `resource-id` shared by twelve rows. The four verdicts:

| Verdict | Means |
| --- | --- |
| `stable` | A unique, app-controlled locator exists. |
| `ambiguous` | The best locator matches several elements. |
| `fragile` | Reachable, but by something that changes — a class name, or an iOS identifier that is really just the visible label. |
| `unreachable` | Nothing but a positional XPath. |

The score is the share of elements that are `stable`. It is deliberately **not** the share
that has *any* locator: every element has an XPath, so that number is always 100% and
measures nothing.

Two rules that follow, and that are each protected by a test:

- **Report the problems first.** An ambiguous `resource-id` is tier 1, so sorting by tier
  buries every real finding underneath everything that is fine. Sort by verdict severity.
- **Count collisions over every element, not just the audited ones.** A second button with
  no text of its own is filtered out of the report but still collides with the first one's
  class name.

---

## Structure

```
src/
  types.ts     Domain types. No logic.
  rank.ts      The ladder: candidates per platform, then first-unique-wins. Pure.
  audit.ts     What is worth auditing, occurrence counting, scoring, screen validation. Pure.
  advice.ts    Turns an audit into things to fix in the app. Pure.
  report.ts    Renders text or JSON. Pure.
  reader.ts    Page source XML -> Screen. Pure string in, data out.
  args.ts      What the command line asked for, and whether the audit cleared it. Pure.
  load.ts      The only module that touches the filesystem, besides the CLI.
  cli.ts       Sequences the others and prints. No decisions of its own.
fixtures/      Curated screens, safe to commit and to run in CI.
tests/         Specs. See below for what is and is not covered.
```

The two fixtures are a matched pair, and changing one without the other loses the point:
`compose-list.screen.json` is a Compose screen that never opted into
`testTagsAsResourceId` (50% stable, advice fires), and `compose-tagged.screen.json` is a
real one that did (100% stable, advice stays quiet).

Six specs cover seven modules with logic: `advice.ts` is exercised through
`tests/report.spec.ts`, and `types.ts` has nothing to test.

`cli.ts` has no spec **by construction**, and that is the standard to hold it to. It runs
`main()` at import, so anything living in it is untestable — which is exactly why argument
parsing and the CI gate were pulled out into `args.ts`, the same way reading a file was
pulled into `load.ts`. If `cli.ts` ever grows a decision, that decision is in the wrong
module. It should stay short enough to read in one screen and contain nothing worth
asserting on.

### The snapshot boundary

This is the load-bearing design decision. `reader.ts` turns a page source into a
**`Screen`** — a plain, serializable list of elements — and *everything downstream is
pure*. Which buys three things:

- The audit is tested offline, with no device, no emulator and no Appium server.
- `--save` writes the screen, so CI re-audits the same screen on every pull request and
  fails when testability regresses. No device in CI.
- A regression is reproducible: attach the screen JSON to the bug.

Anything that needs a device belongs on the reader's side of that line. Anything that
reasons about locators belongs on the pure side. Do not blur it.

### On `reader.ts` not being an XML parser

It is a deliberate ~300-line reader for two specific machine-generated formats, and it
must stay that way rather than growing toward general XML.

The one thing it gets right on purpose: **attribute values are read between their quotes,
never by scanning for the next `>`.** A page source carries user-facing copy, and
user-facing copy contains `>`, `<` and quotes. `text="1 < 2 > 0"` is a real thing a dump
contains, and a naive scan cuts the tag in half there. There is a test named after this.

It handles both shapes a page source comes in, and this is not optional — the two differ:

- `uiautomator dump`: every tag is `<node>`, the class is an attribute, and **there is no
  `displayed` attribute**. Visibility has to come from `bounds="[0,0][1080,2400]"`, where a
  zero-area rectangle is the only signal an element is collapsed.
- Appium's `getPageSource()`: the class **is** the tag, and `displayed` / `visible` are
  present.

Two more traps, both found against a real dump rather than an invented one:

- Empty attributes are written `""`, not omitted. Treat the empty string as absent.
- `hint` exists, and is the only text an empty input field shows.

And one that only shows up on iOS: **`AppiumAUT` must not appear in an XPath.** It is
Appium's envelope, not part of the app tree — Appium's iOS XPath engine is rooted at
`XCUIElementTypeApplication`, so a path leading with `/AppiumAUT[1]/` matches nothing at
all. `hierarchy`, by contrast, really is the Android document root and stays.

### The advice must not accuse a team of a fix they already made

`advice.ts` is where false positives are cheapest to produce and most expensive to ship:
being told to enable something you enabled is how a tool loses its reader. The Compose rule
shipped with exactly that bug and it was only caught by running the tool against a real app
that **had** opted in, so both guards are load-bearing.

- **A bare `resource-id` proves the opt-in is already there.** An id declared in XML always
  arrives fully qualified — `com.example.app:id/name`, or `android:id/content` for a
  framework one. `testTagsAsResourceId` publishes the `testTag` verbatim, so a
  `resource-id` with no `:id/` in it can only have come from a tag. One is proof.
- **Compose merges semantics, so one element can appear twice.** A parent node carries the
  merged `contentDescription` while a child carries the `resource-id`. The parent looks
  untagged on its own, and counting it overstates what the advice would buy — the element
  is already addressable at tier 1 through the child. Compare by **local name**, because
  the `content-desc` is the bare tag while the `resource-id` may be qualified.

The general rule for any new advice: state what evidence in the screen makes it true, then
ask what would make it false and check for that too. Every advice rule needs a test that it
fires *and* a test that it stays quiet.

---

## Conventions (mandatory)

- 4-space indentation, double quotes, trailing semicolons, arrow functions with `const`.
- Section banners are kept: `/** LIBS */`, `/** FIXTURES */`, `/** FUNCTIONS */`,
  `/** EXPORTS */`, `/** TEST SUITE */`.
- **JSDoc on every function**: description, `@param`, `@returns`. Types live in TypeScript,
  not in the JSDoc.
- Every module ends in a single `export { ... }` block under `/** EXPORTS */`.
- Prefer `unknown` over `any`. `parseScreen` exists so a hand-edited file fails with a
  sentence a human can act on instead of a `TypeError` deep inside the ranking.
- **Never write a literal control character into a source file.** In a regular expression
  or a test string, use the escape: `\u0000-\u001f`. Pasting the raw byte has broken this
  code before.

### Comments earn their place

Comment the **why**, never the what. Specifically, the reason a line is written the
strange way it is: which real page source broke the obvious version, or which decision
would look like a bug to the next reader. `// increment the counter` is noise; `// no
displayed attribute in a uiautomator dump` is the reason the code exists.

### Test names are the specification

Tests are named as claims about behaviour, not as labels for methods:

> `prefers a unique content-desc over a resource-id shared by twelve rows`
> `drops AppiumAUT, which is an envelope and not part of the app tree`
> `scores the share that is stable, not the share that has any locator`

Read the list of test names and you have the spec. When you add a rule to the ladder, the
test name says what an app developer would get wrong without it.

---

## Adding a platform rule

1. Add the candidate to `androidCandidates` or `iosCandidates` in `src/rank.ts`, at the
   right tier. A candidate is `{ tier, strategy, value, reason }`.
2. If the value comes from an attribute the reader does not read yet, add it in
   `normalize` in `src/reader.ts` **and** to `MobileElement` in `src/types.ts`.
3. If the reader learns a new attribute, `countValues` in `src/audit.ts` may need to count
   it, or a repeated value will be reported as unique.
4. Add a test named after the mistake the rule catches.
5. `npm run typecheck && npm test`.

---

## Rules for the agent

- **Verify before claiming.** This project exists because a sibling tool shipped a
  confident false positive. If you state that something works, it is because you ran it.
- **Validate against real markup, not an invented fixture.** Every trap listed above was
  found by dumping a real screen; none of them were things I predicted. An invented
  fixture only ever confirms what you already believed.
- **A page source read off a real device never gets committed.** It carries whatever was on
  screen: account names, e-mail addresses, draft text, internal app identifiers. `.gitignore`
  covers `*.xml`, and only curated `fixtures/` are committed. This is a public repository.
- Do not add dependencies. There is no XML library here on purpose.
- Keep the pure side pure. If a change to `rank.ts`, `audit.ts`, `advice.ts` or `report.ts`
  wants to read a file or talk to a device, the change is in the wrong module.
- **Do not trust an exit code that came through a pipe.** `gradle ... | tail` reports
  `tail`'s status, which is 0 while the build fails. Redirect and check explicitly.
- After a structural change — layers, scripts, config, CLI flags — update `README.md` in
  the same change.
