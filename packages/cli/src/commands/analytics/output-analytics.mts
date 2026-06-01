import fs from "node:fs/promises";

import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";

import { debugFileOp } from "../../util/debug.mts";
import { failMsgWithBadge } from "../../util/error/fail-msg-with-badge.mts";
import { mdTableStringNumber } from "../../util/output/markdown.mts";
import { serializeResultJson } from "../../util/output/result-json.mjs";
import { fileLink } from "../../util/terminal/link.mts";

import type { CResult, OutputKind } from "../../types.mts";
import type { SocketSdkSuccessResult } from "@socketsecurity/sdk-stable";

const logger = getDefaultLogger();

const METRICS = [
  "total_critical_alerts",
  "total_high_alerts",
  "total_medium_alerts",
  "total_low_alerts",
  "total_critical_added",
  "total_medium_added",
  "total_low_added",
  "total_high_added",
  "total_critical_prevented",
  "total_high_prevented",
  "total_medium_prevented",
  "total_low_prevented",
] as const;

// Note: This maps `new Date(date).getMonth()` to English three letters
const Months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatDataOrg(
  data: SocketSdkSuccessResult<"getOrgAnalytics">["data"],
): FormattedData {
  const sortedTopFiveAlerts: Record<string, number> = {};
  const totalTopAlerts: Record<string, number> = {};

  const formattedData = {} as Omit<FormattedData, "top_five_alert_types">;
  for (let i = 0, { length } = METRICS; i < length; i += 1) {
    const metric = METRICS[i]!;
    formattedData[metric] = {};
  }

  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i]!;
    const topFiveAlertTypes = entry.top_five_alert_types;
    for (const type of Object.keys(topFiveAlertTypes)) {
      const count = topFiveAlertTypes[type] ?? 0;
      if (totalTopAlerts[type]) {
        totalTopAlerts[type] += count;
      } else {
        totalTopAlerts[type] = count;
      }
    }
  }

  for (let i = 0, { length } = METRICS; i < length; i += 1) {
    const metric = METRICS[i]!;
    const formatted = formattedData[metric];
    for (let i = 0, { length } = data; i < length; i += 1) {
      const entry = data[i]!;
      const date = formatDate(entry.created_at);
      if (formatted[date]) {
        formatted[date] += entry[metric]!;
      } else {
        formatted[date] = entry[metric]!;
      }
    }
  }

  const topFiveAlertEntries = Object.entries(totalTopAlerts)
    .toSorted(([_keya, a], [_keyb, b]) => b - a)
    .slice(0, 5);
  for (const { 0: key, 1: value } of topFiveAlertEntries) {
    sortedTopFiveAlerts[key] = value;
  }

  return {
    ...formattedData,
    top_five_alert_types: sortedTopFiveAlerts,
  };
}

export function formatDataRepo(
  data: SocketSdkSuccessResult<"getRepoAnalytics">["data"],
): FormattedData {
  const sortedTopFiveAlerts: Record<string, number> = {};
  const totalTopAlerts: Record<string, number> = {};

  const formattedData = {} as Omit<FormattedData, "top_five_alert_types">;
  for (let i = 0, { length } = METRICS; i < length; i += 1) {
    const metric = METRICS[i]!;
    formattedData[metric] = {};
  }

  // Aggregate alert counts: sum across time entries (consistent with formatDataOrg).
  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i]!;
    const topFiveAlertTypes = entry.top_five_alert_types;
    for (const type of Object.keys(topFiveAlertTypes)) {
      const count = topFiveAlertTypes[type] ?? 0;
      if (totalTopAlerts[type]) {
        totalTopAlerts[type] += count;
      } else {
        totalTopAlerts[type] = count;
      }
    }
  }
  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i]!;
    for (let i = 0, { length } = METRICS; i < length; i += 1) {
      const metric = METRICS[i]!;
      formattedData[metric]![formatDate(entry.created_at)] = entry[metric];
    }
  }

  const topFiveAlertEntries = Object.entries(totalTopAlerts)
    .toSorted(([_keya, a], [_keyb, b]) => b - a)
    .slice(0, 5);
  for (const { 0: key, 1: value } of topFiveAlertEntries) {
    sortedTopFiveAlerts[key] = value;
  }

  return {
    ...formattedData,
    top_five_alert_types: sortedTopFiveAlerts,
  };
}

export function formatDate(date: string): string {
  const dateObj = new Date(date);
  const month = dateObj.getMonth();
  const day = dateObj.getDate();
  if (Number.isNaN(month) || month < 0 || month > 11 || Number.isNaN(day)) {
    return date.slice(0, 10);
  }
  return `${Months[month]} ${day}`;
}

type OutputAnalyticsConfig = {
  filepath: string;
  outputKind: OutputKind;
  repo: string;
  scope: string;
  time: number;
};

export async function outputAnalytics(
  result: CResult<
    | SocketSdkSuccessResult<"getOrgAnalytics">["data"]
    | SocketSdkSuccessResult<"getRepoAnalytics">["data"]
  >,
  { filepath, outputKind, repo, scope, time }: OutputAnalyticsConfig,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1;
  }

  if (!result.ok) {
    if (outputKind === "json") {
      logger.log(serializeResultJson(result));
      return;
    }
    logger.fail(failMsgWithBadge(result.message, result.cause));
    return;
  }

  if (outputKind === "json") {
    const serialized = serializeResultJson(result);

    if (filepath) {
      try {
        await fs.writeFile(filepath, serialized, "utf8");
        debugFileOp("write", filepath);
        logger.success(`Data successfully written to ${fileLink(filepath)}`);
      } catch (e) {
        debugFileOp("write", filepath, e);
        process.exitCode = 1;
        logger.log(
          serializeResultJson({
            ok: false,
            message: "File Write Failure",
            cause: "There was an error trying to write the json to disk",
          }),
        );
      }
    } else {
      logger.log(serialized);
    }

    return;
  }

  const fdata = scope === "org" ? formatDataOrg(result.data) : formatDataRepo(result.data);

  // Default + OUTPUT_MARKDOWN: render the markdown report. The
  // previous default branched through an iocraft TUI renderer; the
  // renderer was retired alongside iocraft itself, and markdown is the
  // natural plain-text fallback.
  const serialized = renderMarkdown(fdata, time, repo);

  // Write markdown output to file if filepath is specified.
  if (filepath) {
    try {
      await fs.writeFile(filepath, serialized, "utf8");
      debugFileOp("write", filepath);
      logger.success(`Data successfully written to ${fileLink(filepath)}`);
    } catch (e) {
      debugFileOp("write", filepath, e);
      logger.error(e);
    }
  } else {
    logger.log(serialized);
  }
}

export interface FormattedData {
  top_five_alert_types: Record<string, number>;
  total_critical_alerts: Record<string, number>;
  total_high_alerts: Record<string, number>;
  total_medium_alerts: Record<string, number>;
  total_low_alerts: Record<string, number>;
  total_critical_added: Record<string, number>;
  total_medium_added: Record<string, number>;
  total_low_added: Record<string, number>;
  total_high_added: Record<string, number>;
  total_critical_prevented: Record<string, number>;
  total_high_prevented: Record<string, number>;
  total_medium_prevented: Record<string, number>;
  total_low_prevented: Record<string, number>;
}

export function renderMarkdown(data: FormattedData, days: number, repoSlug: string): string {
  return `${`
# Socket Alert Analytics

These are the Socket.dev analytics for the ${repoSlug ? `${repoSlug} repo` : "org"} of the past ${days} days

${[
  ["Total critical alerts", mdTableStringNumber("Date", "Counts", data.total_critical_alerts)],
  ["Total high alerts", mdTableStringNumber("Date", "Counts", data.total_high_alerts)],
  [
    "Total critical alerts added to the main branch",
    mdTableStringNumber("Date", "Counts", data.total_critical_added),
  ],
  [
    "Total high alerts added to the main branch",
    mdTableStringNumber("Date", "Counts", data.total_high_added),
  ],
  [
    "Total critical alerts prevented from the main branch",
    mdTableStringNumber("Date", "Counts", data.total_critical_prevented),
  ],
  [
    "Total high alerts prevented from the main branch",
    mdTableStringNumber("Date", "Counts", data.total_high_prevented),
  ],
  [
    "Total medium alerts prevented from the main branch",
    mdTableStringNumber("Date", "Counts", data.total_medium_prevented),
  ],
  [
    "Total low alerts prevented from the main branch",
    mdTableStringNumber("Date", "Counts", data.total_low_prevented),
  ],
]
  .map(([title, table]) =>
    `
## ${title}

${table}
`.trim(),
  )
  .join("\n\n")}

## Top 5 alert types

${mdTableStringNumber("Name", "Counts", data.top_five_alert_types)}
`.trim()}\n`;
}
