/** LIBS */
import type { MobileElement, Ranked, Strategy, Verdict } from "./types.ts";

/**
 * How many elements on the screen share each of this element's candidate values.
 *
 * Uniqueness is not a detail — it is half the question. A `resource-id` repeated across
 * twelve rows of a list is a perfectly stable string that still cannot address one row;
 * Appium hands back the first match and the test quietly asserts on the wrong item. So
 * every rung is checked for uniqueness, not just `class name`.
 */
export interface Context {
    resourceId: number;
    accessibilityId: number;
    label: number;
    text: number;
    className: number;
}

/** One rung of the ladder, already resolved against a specific element. */
interface Candidate {
    tier: number;
    strategy: Strategy;
    value: string;
    /** The verdict when this candidate is unique on the screen. */
    verdict: Verdict;
    reason: string;
    /** How many elements this candidate matches. */
    matches: number;
}

/** FUNCTIONS */

/**
 * Strip a candidate down to the fields a ranking carries.
 *
 * @param candidate - The winning candidate.
 * @returns Its tier, strategy, value, verdict and reason.
 */
const pick = (candidate: Candidate): Omit<Ranked, "element"> => {
    const { tier, strategy, value, verdict, reason } = candidate;

    return { tier, strategy, value, verdict, reason };
};

/** Escape double quotes for a UiSelector or predicate string literal. */
const escape = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * The Android ladder, best first, keeping only the rungs this element can actually use.
 *
 * `resource-id` sits above `content-desc` on purpose: it is set in the layout at build
 * time and is **never translated**, while `content-desc` exists for screen readers and is
 * a legitimate target for localization. A translated `content-desc` breaks the locator in
 * exactly one locale, which is the worst way to find out. This tool ranks by stability, so
 * build-time beats runtime.
 *
 * @param element - The element to describe.
 * @param context - Occurrence counts for the whole screen.
 * @returns The usable candidates, best first.
 */
const androidCandidates = (element: MobileElement, context: Context): Candidate[] => {
    const candidates: Candidate[] = [];

    if (element.resourceId) {
        candidates.push({
            tier: 1,
            strategy: "id",
            value: element.resourceId,
            verdict: "stable",
            reason: "Set in the layout at build time, and never translated.",
            matches: context.resourceId,
        });
    }

    if (element.accessibilityId) {
        candidates.push({
            tier: 2,
            strategy: "accessibility id",
            value: element.accessibilityId,
            verdict: "stable",
            reason: "content-desc — also works on iOS, but it can be localized.",
            matches: context.accessibilityId,
        });
    }

    if (element.text) {
        candidates.push({
            tier: 3,
            strategy: "-android uiautomator",
            value: `new UiSelector().text("${escape(element.text)}")`,
            verdict: "fragile",
            reason: "Only the visible text — breaks on copy edits and on every translation.",
            matches: context.text,
        });
    }

    return candidates;
};

/**
 * The iOS ladder, best first.
 *
 * There is no `resource-id` equivalent, so `accessibility id` is the top rung — the
 * asymmetry with Android is real, not an oversight.
 *
 * **The trap this encodes:** XCUITest's `name` is the accessibility identifier *when one
 * is set*, and otherwise falls back to the visible `label`. A `name` equal to the `label`
 * is therefore almost never a real identifier — it is on-screen text wearing an
 * identifier's clothes, and it moves with the next translation. It keeps tier 1, because
 * `accessibility id` is still the strategy to use, but the verdict drops to fragile.
 * Calling that stable would be the tool lying about its own subject.
 *
 * @param element - The element to describe.
 * @param context - Occurrence counts for the whole screen.
 * @returns The usable candidates, best first.
 */
const iosCandidates = (element: MobileElement, context: Context): Candidate[] => {
    const candidates: Candidate[] = [];

    if (element.accessibilityId) {
        const echoesTheLabel = element.label !== null && element.accessibilityId === element.label;

        candidates.push({
            tier: 1,
            strategy: "accessibility id",
            value: element.accessibilityId,
            verdict: echoesTheLabel ? "fragile" : "stable",
            reason: echoesTheLabel
                ? "`name` equals `label`, so this is the visible text rather than a real " +
                  "accessibility identifier — it moves with translations."
                : "A real accessibility identifier, distinct from the visible label.",
            matches: context.accessibilityId,
        });
    }

    if (element.label) {
        candidates.push({
            tier: 2,
            strategy: "-ios predicate string",
            value: `label == "${escape(element.label)}"`,
            verdict: "fragile",
            reason: "Only the visible label — breaks on copy edits and on every translation.",
            matches: context.label,
        });
    }

    if (element.text) {
        candidates.push({
            tier: 3,
            strategy: "-ios predicate string",
            value: `value == "${escape(element.text)}"`,
            verdict: "fragile",
            reason: "Only the field's value, which changes as soon as anyone types.",
            matches: context.text,
        });
    }

    return candidates;
};

/**
 * Rank one element.
 *
 * The rule that matters: **the first *unique* candidate wins, not the highest-ranked
 * one.** A `content-desc` that addresses exactly this element beats a `resource-id`
 * shared with eleven siblings, because the better string is worthless if it cannot pick
 * the element out. When nothing is unique, the best candidate is reported as `ambiguous`
 * — a different problem from instability, with a different fix: combine it with an index
 * or a neighbouring value.
 *
 * @param element - The element to rank.
 * @param context - Occurrence counts for the whole screen.
 * @returns The ranking.
 */
const rankElement = (element: MobileElement, context: Context): Ranked => {
    const semantic =
        element.platform === "android"
            ? androidCandidates(element, context)
            : iosCandidates(element, context);

    const unique = semantic.find((candidate) => candidate.matches === 1);

    if (unique) {
        return { element, ...pick(unique) };
    }

    // A unique class or type is a working locator, so it beats an ambiguous one — even
    // though it is the weaker string, it can at least address this element.
    if (context.className === 1) {
        return {
            element,
            tier: 4,
            strategy: "class name",
            value: element.className,
            verdict: "fragile",
            reason: "Unique on this screen today; stops being a locator when a second one appears.",
        };
    }

    const best = semantic[0];

    if (best) {
        return {
            element,
            tier: best.tier,
            strategy: best.strategy,
            value: best.value,
            verdict: "ambiguous",
            reason:
                `Matches ${best.matches} elements on this screen — a stable string that still ` +
                `cannot pick this one out. Combine it with an index or a neighbouring value.`,
        };
    }

    return {
        element,
        tier: 5,
        strategy: "xpath",
        value: element.xpath,
        verdict: "unreachable",
        reason:
            element.platform === "android"
                ? "No resource-id, no content-desc, no text — only its position in the tree."
                : "No accessibility identifier, no label, no value — only its position in the tree.",
    };
};

/** EXPORTS */
export { androidCandidates, iosCandidates, rankElement };
