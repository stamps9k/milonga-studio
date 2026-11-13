import type { JoinAssessment, JoinIssue } from "../libs/dance/join.mts";
import type { Partner } from "../libs/dance/step.mts";

/**
 * Plain-language descriptions of a join assessment (libs/dance/join.mts)
 * for tooltips and warnings in the figure library and sequence strip.
 *
 * Kept out of the dance model on purpose: the model reports structured
 * issues, and the wording is a UI decision. Distances are shown in
 * metres, the working unit of the seed data (see the Units section of
 * src/libs/dance/AGENTS.md); change the suffix here if the floor unit
 * is ever fixed to something else.
 */

const PARTNER_NAME: Record<Partner, string> = {
  lead: "Lead",
  follow: "Follow",
};

function formatDistance(distance: number): string {
  return `${distance.toFixed(2)} m`;
}

function describeFacing(issue: Extract<JoinIssue, { kind: "facing-change" }>) {
  const direction = issue.degrees > 0 ? "clockwise" : "anticlockwise";
  return `${PARTNER_NAME[issue.partner]} would snap ${Math.round(
    Math.abs(issue.degrees),
  )}° ${direction}`;
}

function describeWeightedFoot(
  issue: Extract<JoinIssue, { kind: "weighted-foot" }>,
) {
  return `${PARTNER_NAME[issue.partner]} would start on the ${issue.foot} foot, which is carrying the weight`;
}

/**
 * One line per problem, most visible first: the foot gap (as a single
 * line with the largest jump, rather than one line per foot), then
 * facing snaps, then weighted-foot starts. Empty when the join fits.
 */
export function describeJoin(assessment: JoinAssessment): string[] {
  const lines: string[] = [];
  if (assessment.issues.some((issue) => issue.kind === "foot-gap")) {
    lines.push(
      `Feet would jump up to ${formatDistance(assessment.maxFootGap)}`,
    );
  }
  for (const issue of assessment.issues) {
    if (issue.kind === "facing-change") lines.push(describeFacing(issue));
  }
  for (const issue of assessment.issues) {
    if (issue.kind === "weighted-foot") lines.push(describeWeightedFoot(issue));
  }
  return lines;
}
