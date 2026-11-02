"use client";

import React from "react";
import { Check, type LucideProps } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

const ICON_SET = new Set<string>(iconNames);

export function isLucideIconName(name: string): name is IconName {
  return ICON_SET.has(name);
}

/**
 * Renders any Lucide icon by its kebab-case name (e.g. "zap"), loading only that
 * icon on demand. Unknown names fall back to a check mark.
 */
export function LucideIcon({ name, ...props }: LucideProps & { name: string }) {
  if (!isLucideIconName(name)) return <Check {...props} />;
  return <DynamicIcon name={name} fallback={() => <Check {...props} />} {...props} />;
}
