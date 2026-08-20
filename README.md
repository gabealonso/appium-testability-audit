# appium-testability-audit

Audits an Appium page source for **testability**: it ranks every element by how stable a
locator you can write for it, and reports what only a positional XPath can reach.

Point it at a screen before you write the tests, and you find out that the button has no
identifier — instead of finding out three sprints later, when a layout change breaks
fourteen XPaths at once.

Zero runtime dependencies. Node runs the TypeScript directly; there is no build step.

---

## Why

Flaky mobile suites are usually not a test problem. They are an **app** problem that
surfaces in the tests: nobody set a `resource-id`, so the test had to reach the element by
its position in the view tree, and the view tree is the one thing a UI refactor is
guaranteed to change.

Two questions decide how good a locator is, and most tools only ask the first.

1. **Is the attribute one the app controls?** A `resource-id` is set by a developer on
   purpose. A position in the tree is set by whoever last touched the layout.
2. **Is the value unique on this screen?** A list whose twelve rows all share
   `resource-id=".../row_title"` has twelve perfectly stable-*looking* locators that each
   match twelve elements. Appium returns the first one, so **a test can pass while
   asserting on the wrong row** — the worst failure mode there is, because it is silent.

So this tool reports four verdicts, not two:

| Verdict | Means | What to do |
| --- | --- | --- |
| `ok` | Unique, app-controlled locator. | Nothing. |
| `MANY` | Stable, but matches several elements. | Give each row a distinct id, or scope to the row. |
| `warn` | Reachable, but by something that changes — a class name, or an iOS identifier that is really just the visible label. | Add a real identifier. |
| `FAIL` | Nothing but a positional XPath. | Add a `resource-id`, `contentDescription`, or `accessibilityIdentifier`. |

The score is the share of elements that are `ok`. It is deliberately **not** the share that
has *any* locator — every element has an XPath, so that number is always 100% and measures
nothing.

---

## Requirements

Node **23 or newer**. That is the version that runs `.ts` files directly, which is why this
project has no build step and no `tsx`.

```bash
git clone https://github.com/gabealonso/appium-testability-audit.git
cd appium-testability-audit
npm install
```

`npm install` pulls `typescript` and `@types/node`, and nothing else. They are
devDependencies, used by `npm run typecheck`.

---

## Usage

Try it on the bundled fixture, with no device involved:

```bash
node src/cli.ts fixtures/compose-list.screen.json
```

Then on a real screen. Get a page source either way:

```bash
adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml
```

or, from an Appium test, write `await driver.getPageSource()` to a file. Both work:

```bash
node src/cli.ts ui.xml
```

Which format a file is comes from its **first character**, not its name — a page source
opens with `<` and a saved screen with `{` — so a dump saved as `ui.txt` still works.

### Options

| Option | Does |
| --- | --- |
| `--save <file>` | Write the screen as JSON, to audit later without a device |
| `--json` | Print the JSON report instead of the readable one |
| `--max-unreachable N` | Exit 1 when more than N elements cannot be reached |
| `--max-ambiguous N` | Exit 1 when more than N locators match several elements |
| `-h`, `--help` | Show help |

---

## What the output looks like

```
# Testability audit

- Platform: android
- Source: fixture: a Compose list screen that has not opted into testTagsAsResourceId
- Elements: 10
- Stable: 5 · Ambiguous: 2 · Fragile: 1 · Unreachable: 2
- Score: 50% stable

      ELEMENT                      STRATEGY              VALUE
FAIL  ImageView                    xpath                 //android.widget.FrameLayout[2]/android.widget.ImageView[1]
FAIL  ImageView                    xpath                 //android.widget.FrameLayout[2]/android.widget.ImageView[2]
MANY  TextView "Buy milk"          id                    com.example.app:id/row_title
MANY  TextView "Buy milk"          id                    com.example.app:id/row_title
warn  TextView "Walk the dog"      -android uiautomator  new UiSelector().text("Walk the dog")
ok    EditText "todo_input_field"  accessibility id      todo_input_field
ok    View "blue_banner"           accessibility id      blue_banner
ok    View "todo_app_title"        accessibility id      todo_app_title
ok    View "add_todo_row"          accessibility id      add_todo_row
ok    Button "add_todo_button"     id                    com.example.app:id/add_todo_button

## Enable testTagsAsResourceId (3 elements would move to tier 1)

This looks like Jetpack Compose: generic android.view.View nodes carrying a content-desc
but no resource-id. Compose does not expose testTag to Appium unless the app opts in. Add
it once, near the root:
    Modifier.semantics { testTagsAsResourceId = true }
Every existing testTag then arrives as a resource-id, with no other change.
```

Problems are listed **first**. An ambiguous `resource-id` is a tier-1 locator, so sorting
by tier would bury every real finding underneath everything that is already fine.

The `VALUE` column is the locator a test would actually pass to Appium — copy it straight
into `findElement`.

### The Compose trap

That first piece of advice is the most common real finding on a modern Android app.
`Modifier.testTag("add_button")` does **not** reach Appium. The tags are there, the team
believes the screen is instrumented, and the page source shows bare `android.view.View`
nodes with no `resource-id`. One line near the root of the activity fixes every tag at
once:

```kotlin
Modifier.semantics { testTagsAsResourceId = true }
```

And when the app has already opted in, the advice stays quiet — it does not tell you to fix
what you fixed. The proof it looks for is a **bare** `resource-id`: an id declared in XML
always arrives fully qualified (`com.example.app:id/name`), while `testTagsAsResourceId`
publishes the tag verbatim, so a `resource-id` with no `:id/` in it can only have come from
a `testTag`. Compare the two bundled fixtures to see both sides:

```bash
node src/cli.ts fixtures/compose-list.screen.json     # never opted in:  50% stable
node src/cli.ts fixtures/compose-tagged.screen.json   # opted in:       100% stable
```

---

## In CI, without a device

`--save` is the point of the architecture. Reading a page source needs a device; auditing
one does not.

```bash
node src/cli.ts ui.xml --save screens/checkout.screen.json
```

```bash
node src/cli.ts screens/checkout.screen.json --max-unreachable 0 --max-ambiguous 0
```

Run the first once, on a machine with a device attached. Run the second on every pull
request — no device, no emulator, no Appium server. The build then fails when someone adds
an element a test cannot address, at review time rather than when the suite goes red a
month later.

> A page source read off a real device carries whatever was on the screen: account names,
> e-mail addresses, draft text, internal app identifiers. `.gitignore` keeps raw `*.xml`
> dumps out of the repository. Look at a saved screen before you commit it.

---

## How it is put together

```
src/
  types.ts     Domain types. No logic.
  rank.ts      The ladder: candidates per platform, then first-unique-wins. Pure.
  audit.ts     What is worth auditing, occurrence counting, scoring, validation. Pure.
  advice.ts    Turns an audit into things to fix in the app. Pure.
  report.ts    Renders text or JSON. Pure.
  reader.ts    Page source XML -> Screen. Pure: string in, data out.
  args.ts      What the command line asked for, and whether the audit cleared it. Pure.
  load.ts      Reads a file as either format. The filesystem boundary.
  cli.ts       Sequences the others and prints. No decisions of its own.
fixtures/      Curated screens, safe to commit and to run in CI.
tests/         Specs, named as claims about behaviour.
```

Everything except `load.ts` and `cli.ts` is pure. `reader.ts` turns a page source into a
plain, serializable `Screen`, and every decision downstream of that is a function of data.
That is what makes the whole audit testable with no device attached, and a reported
regression reproducible by attaching one JSON file.

```bash
npm test           # no device, no network
npm run typecheck
```

`reader.ts` is a deliberate reader for two specific machine-generated formats, not a
general XML parser. The thing it gets right on purpose: attribute values are read between
their quotes, never by scanning for the next `>`. A page source carries user-facing copy,
and `text="1 < 2 > 0"` is a real thing a dump contains — a naive scan cuts the tag in half
right there.

---

## Platform notes

**Android.** Ladder: `resource-id` → `content-desc` → `text` via `UiSelector`. A
`uiautomator dump` has no `displayed` attribute, unlike Appium's own page source, so
visibility comes from a zero-area `bounds` rectangle. `hint` is read as text, because it is
the only thing an empty input field shows.

**iOS.** Ladder: `accessibility id` → `label` predicate → `value` predicate. When `name`
equals `label` the verdict drops to `warn`: iOS falls back to the visible label when no
`accessibilityIdentifier` is set, so the identifier that looks present is really just the
copy — it changes when a copywriter changes it, and breaks outright on localisation.
`AppiumAUT` never appears in a reported XPath: it is Appium's envelope, not part of the app
tree, and the iOS XPath engine is rooted at `XCUIElementTypeApplication`.

---

## Licence

MIT.
