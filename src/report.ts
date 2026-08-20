/** LIBS */
import { adviceFor } from "./advice.ts";
import type { Audit, Ranked, Verdict } from "./types.ts";

/** How each verdict reads in the report. */
const MARK: Record<Verdict, string> = {
    stable: "ok",
    ambiguous: "MANY",
    fragile: "warn",
    unreachable: "FAIL",
};

/** FUNCTIONS */

/**
 * Render a matrix of cells as a left-aligned text table. The last column is not padded so
 * lines never carry trailing spaces.
 *
 * @param rows - The rows to render, each one a list of cells.
 * @returns The table as a multi-line string.
 */
const table = (rows: string[][]): string => {
    const widths = rows.reduce<number[]>(
        (acc, row) => row.map((cell, index) => Math.max(acc[index] ?? 0, cell.length)),
        []
    );

    return rows
        .map((row) =>
            row
                .map((cell, index) =>
                    index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)
                )
                .join("  ")
                .trimEnd()
        )
        .join("\n");
};

/**
 * Describe an element briefly enough to find it on the screen.
 *
 * @param item - The ranked element.
 * @returns A short human label.
 */
const label = (item: Ranked): string => {
    const { element } = item;
    const name = element.accessibilityId ?? element.label ?? element.text;
    // The class is the only thing every element has, and its package prefix is noise.
    const type = element.className.split(".").pop() ?? element.className;

    return name ? `${type} "${name}"` : type;
};

/**
 * Render the audit as a terminal/markdown report, worst first.
 *
 * The summary leads with what cannot be reached and what is ambiguous, because those are
 * the actionable parts — a list a QA can hand to the team.
 *
 * @param audit - The audit to render.
 * @returns The report as a printable string.
 */
const renderReport = (audit: Audit): string => {
    const { counts } = audit;
    const total = audit.ranked.length;

    const header = [
        "",
        "# Testability audit",
        "",
        `- Platform: ${audit.platform}`,
        `- Source: ${audit.source}`,
        `- Elements: ${total}`,
        `- Stable: ${counts.stable} · Ambiguous: ${counts.ambiguous} · ` +
            `Fragile: ${counts.fragile} · Unreachable: ${counts.unreachable}`,
        `- Score: ${audit.score}% stable`,
        "",
    ].join("\n");

    if (total === 0) {
        return `${header}No element on this screen could be targeted by a test.\n`;
    }

    const rows = [
        ["", "ELEMENT", "STRATEGY", "VALUE"],
        ...audit.ranked.map((item) => [MARK[item.verdict], label(item), item.strategy, item.value]),
    ];

    const advice = adviceFor(audit);

    const whatToDo =
        advice.length === 0
            ? "Every element has a unique locator that does not depend on the tree shape.\n"
            : `${advice
                  .map((item) => `## ${item.title}\n\n${item.detail}`)
                  .join("\n\n")}\n`;

    return `${header}\n${table(rows)}\n\n${whatToDo}`;
};

/**
 * Render the audit as JSON, for a CI step to read.
 *
 * @param audit - The audit to render.
 * @returns Pretty-printed JSON.
 */
const renderJson = (audit: Audit): string => {
    return JSON.stringify(
        {
            platform: audit.platform,
            source: audit.source,
            score: audit.score,
            counts: audit.counts,
            advice: adviceFor(audit),
            elements: audit.ranked.map((item) => ({
                className: item.element.className,
                tier: item.tier,
                strategy: item.strategy,
                value: item.value,
                verdict: item.verdict,
                reason: item.reason,
                xpath: item.element.xpath,
            })),
        },
        null,
        2
    );
};

/** EXPORTS */
export { renderReport, renderJson };
