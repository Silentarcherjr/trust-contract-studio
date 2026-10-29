import type { Verdict } from "@shared/domain";
import {
  IconCheck,
  IconQuestionMark,
  IconX,
  IconMinus,
} from "@tabler/icons-react";

const ICONS = {
  VERIFIED: IconCheck,
  FAILED: IconX,
  UNKNOWN: IconQuestionMark,
  PENDING: IconMinus,
  NOT_PURSUED: IconMinus,
} as const;

export function Seal({
  verdict,
  size,
  label,
}: {
  verdict: Verdict | "PENDING" | "NOT_PURSUED" | null | undefined;
  size?: "lg";
  label?: string;
}) {
  const v = verdict ?? "PENDING";
  const Icon = ICONS[v];
  const text =
    label ??
    (v === "PENDING"
      ? "Not verified yet"
      : v === "NOT_PURSUED"
        ? "Not pursued"
        : v);
  return (
    <span
      className="tcs-seal"
      data-verdict={v === "NOT_PURSUED" ? "PENDING" : v}
      data-size={size}
    >
      <Icon size={size === "lg" ? 14 : 11} stroke={2.6} aria-hidden />
      {text}
    </span>
  );
}
