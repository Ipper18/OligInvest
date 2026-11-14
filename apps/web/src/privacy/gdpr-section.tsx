"use client";
import dynamic from "next/dynamic";

/** Code-split: the GDPR controls load only when /ustawienia renders them (R-53, BL-114). */
export const GdprSection = dynamic(
  () => import("./gdpr-settings").then((module) => module.GdprSettings),
  { ssr: false },
);
