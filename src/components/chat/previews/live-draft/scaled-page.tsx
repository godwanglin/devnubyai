"use client";

import React from "react";

/** A page drawn at its natural size in points (1pt = 1px) and scaled to the panel width. */
export function ScaledPage({
  width,
  height,
  scale,
  background = "#ffffff",
  children,
}: {
  width: number;
  height: number;
  scale: number;
  background?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mx-auto mb-4 shrink-0 overflow-hidden rounded-[3px] shadow-[0_1px_3px_rgba(0,0,0,0.35),0_8px_24px_rgba(0,0,0,0.25)]"
      style={{ width: width * scale, height: height * scale }}
    >
      <div
        style={{
          position: "relative",
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          backgroundColor: background,
          color: "#111111",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
