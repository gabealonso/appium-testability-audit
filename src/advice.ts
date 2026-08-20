/** LIBS */
import type { Advice, Audit, MobileElement } from "./types.ts";

/** How many Compose-looking elements it takes before the pattern is worth calling out. */
const COMPOSE_THRESHOLD = 3;

/** FUNCTIONS */

/**
 * Whether an element looks like a Jetpack Compose node whose `testTag` never reached
 * Appium.
 *
 * Compose collapses its tree into generic `android.view.View` nodes and does **not**
 * publish `testTag` as `resource-id` unless the app opts in with
 * `testTagsAsResourceId = true`. Teams discover this the hard way: they tag everything,
 * the Compose tests pass, and Appium still sees nothing to hold on to. The giveaway is a
 * generic view that has a `content-desc` but no `resource-id` — someone set semantics,
 * and only half of it came through.
 *
 * @param element - The element to inspect.
 * @returns True when the element fits that shape.
 */
const looksLikeUntaggedCompose = (element: MobileElement): boolean => {
    return (
        element.platform === "android" &&
        element.className === "android.view.View" &&
        element.accessibilityId !== null &&
        element.resourceId === null
    );
};

/**
 * Whether the screen proves the app already opted into `testTagsAsResourceId`.
 *
 * An id declared in XML always arrives fully qualified — `com.example.app:id/name`, or
 * `android:id/content` for a framework one. `testTagsAsResourceId` publishes the `testTag`
 * string verbatim instead, so a **bare** `resource-id` with no `:id/` in it can only have
 * come from a tag. One of those is proof the opt-in is already there, and advising it again
 * would be telling a team to fix something they fixed.
 *
 * @param elements - Every audited element.
 * @returns True when at least one resource-id came from a testTag.
 */
const hasTestTagResourceIds = (elements: MobileElement[]): boolean => {
    return elements.some(
        (element) => element.resourceId !== null && !element.resourceId.includes(":id/")
    );
};

/**
 * Count the elements that would actually gain something from the opt-in.
 *
 * Compose merges semantics: for one logical element it can emit a parent node carrying the
 * merged `contentDescription` and a child node carrying the `resource-id`. The parent looks
 * untagged on its own, but the element is already addressable at tier 1 through the child,
 * so counting it overstates what the advice would buy — the number has to mean what it
 * says.
 *
 * @param elements - Every audited element.
 * @returns How many untagged-looking elements are not already covered elsewhere.
 */
const countUncoveredCompose = (elements: MobileElement[]): number => {
    // Compared by local name: a `content-desc` is the bare tag, while a `resource-id` may
    // arrive fully qualified, so `add_todo_button` and
    // `com.example.app:id/add_todo_button` name the same element.
    const localName = (id: string): string => {
        const marker = id.indexOf(":id/");

        return marker === -1 ? id : id.slice(marker + ":id/".length);
    };

    const covered = new Set(
        elements
            .map((element) => element.resourceId)
            .filter((id): id is string => id !== null)
            .map(localName)
    );

    return elements.filter(
        (element) =>
            looksLikeUntaggedCompose(element) && !covered.has(element.accessibilityId ?? "")
    ).length;
};

/**
 * Work out what the team could change, from what the audit found.
 *
 * This is the other half of an auditor: a verdict without a fix is just a complaint. Each
 * rule fires only on evidence in the screen, so the advice is never generic.
 *
 * @param audit - The finished audit.
 * @returns The advice worth acting on, most valuable first.
 */
const adviceFor = (audit: Audit): Advice[] => {
    const advice: Advice[] = [];
    const elements = audit.ranked.map((item) => item.element);

    const composeish = hasTestTagResourceIds(elements) ? 0 : countUncoveredCompose(elements);

    if (composeish >= COMPOSE_THRESHOLD) {
        advice.push({
            title: `Enable testTagsAsResourceId (${composeish} elements would move to tier 1)`,
            detail:
                "This looks like Jetpack Compose: generic android.view.View nodes carrying a " +
                "content-desc but no resource-id. Compose does not expose testTag to Appium " +
                "unless the app opts in. Add it once, near the root:\n" +
                "    Modifier.semantics { testTagsAsResourceId = true }\n" +
                "Every existing testTag then arrives as a resource-id, with no other change.",
        });
    }

    if (audit.counts.ambiguous > 0) {
        advice.push({
            title: `${audit.counts.ambiguous} locators match more than one element`,
            detail:
                "These identifiers are stable but not unique — typically a list where every " +
                "row repeats the same id. Appium returns the first match, so a test can pass " +
                "while asserting on the wrong row. Either give each row a distinct id, or " +
                "combine the shared one with an index or a neighbouring value.",
        });
    }

    if (audit.counts.unreachable > 0) {
        advice.push({
            title: `${audit.counts.unreachable} elements need an identifier`,
            detail:
                "Nothing but a positional XPath can address these, which breaks the moment " +
                "the layout changes. On Android give them a resource-id or a content-desc; on " +
                "iOS set an accessibilityIdentifier.",
        });
    }

    const echoedNames = audit.ranked.filter(
        (item) =>
            item.element.platform === "ios" &&
            item.strategy === "accessibility id" &&
            item.verdict === "fragile"
    ).length;

    if (echoedNames > 0) {
        advice.push({
            title: `${echoedNames} iOS elements have no real accessibility identifier`,
            detail:
                "Their `name` is identical to their `label`, which is what XCUITest reports " +
                "when no identifier is set — so the locator is really the visible text and it " +
                "moves with the next translation. Set accessibilityIdentifier explicitly, " +
                "separately from the visible label.",
        });
    }

    return advice;
};

/** EXPORTS */
export { looksLikeUntaggedCompose, hasTestTagResourceIds, countUncoveredCompose, adviceFor };
