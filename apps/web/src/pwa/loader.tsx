"use client";
import { type ComponentType, useEffect, useState } from "react";
export function PwaLoader() {
  const [Registration, setRegistration] = useState<ComponentType | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void import("./registration")
        .then((module) => {
          if (alive) setRegistration(() => module.PwaRegistration);
        })
        .catch(() => {});
    if (document.readyState === "complete") load();
    else window.addEventListener("load", load, { once: true });
    return () => {
      alive = false;
      window.removeEventListener("load", load);
    };
  }, []);
  return Registration ? <Registration /> : null;
}
