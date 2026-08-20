/** TYPES */

/** The two platforms a page source can come from. */
export type Platform = "android" | "ios";

/**
 * One element as read from an Appium page source, normalized across platforms.
 *
 * This is the only thing the ranking consumes, which is what keeps it pure: a reader
 * turns XML into these, and the ranking judges them. A saved page source can therefore
 * be re-audited in CI with no device, no emulator and no Appium server.
 *
 * The platforms name the same ideas differently, so they are normalized here:
 *
 * | Concept | Android attribute | iOS attribute |
 * | --- | --- | --- |
 * | `className` | `class` (`android.widget.Button`) | `type` (`XCUIElementTypeButton`) |
 * | `resourceId` | `resource-id` | — (no equivalent) |
 * | `accessibilityId` | `content-desc` | `name` |
 * | `label` | — | `label` |
 * | `text` | `text` | `value` |
 */
export interface MobileElement {
    platform: Platform;
    className: string;
    /** Android only: the developer's view id, e.g. `com.example.app:id/add_button`. */
    resourceId: string | null;
    /** What Appium's `accessibility id` strategy matches on. */
    accessibilityId: string | null;
    /** iOS only: the visible label. Android has no separate label attribute. */
    label: string | null;
    text: string | null;
    clickable: boolean;
    displayed: boolean;
    /** Positional path, always present so an element is never unaddressable. */
    xpath: string;
}

/**
 * An Appium locator strategy. These are the strategy names Appium itself accepts, not
 * one client library's syntax — a report that says `accessibility id: add_button` is
 * correct whether the reader uses WebdriverIO, Appium's Python client, or Java.
 */
export type Strategy =
    | "id"
    | "accessibility id"
    | "-android uiautomator"
    | "-ios predicate string"
    | "class name"
    | "xpath";

/**
 * How much trust a locator earns.
 *
 * `ambiguous` is its own verdict, not a flavour of `fragile`, because it is a different
 * problem with a different fix. A `resource-id` shared by twelve list rows is perfectly
 * stable — it just cannot pick out one row, so Appium returns the first match and the
 * test asserts on the wrong item. The fix is to combine it with an index or a
 * neighbouring value, not to ask anyone to change the app.
 */
export type Verdict = "stable" | "ambiguous" | "fragile" | "unreachable";

/** The ranking of one element: how to locate it, and how worried to be. */
export interface Ranked {
    element: MobileElement;
    /** 1 (best) to 5 (worst). */
    tier: number;
    strategy: Strategy;
    verdict: Verdict;
    /** The value to pass to that strategy. */
    value: string;
    /** Why this strategy and not a better one, in one line. */
    reason: string;
}

/**
 * A screen as it lands on disk: what the reader produces and the audit consumes.
 *
 * Saving one lets a CI job re-audit the same screen with no device, no emulator and no
 * Appium server, and turns a score change into a reviewable diff.
 */
export interface Screen {
    platform: Platform;
    /** Where it came from — an app package, a screen name, a file. */
    source: string;
    /** When the page source was read, ISO 8601. */
    readAt: string;
    elements: MobileElement[];
}

/** One thing the team could change to make the screen testable. */
export interface Advice {
    title: string;
    detail: string;
}

/** The audit of a whole screen. */
export interface Audit {
    platform: Platform;
    /** Where the page source came from — an app package, a screen name, a file. */
    source: string;
    ranked: Ranked[];
    counts: Record<Verdict, number>;
    /** Share of elements that are stable, 0-100, rounded. */
    score: number;
}
