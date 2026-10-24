"use client";
import { marketMessages as m, portfolioMessages as p } from "@oliginvest/i18n";
import { useState } from "react";
import { Explainer } from "../education/explainer";
import { readResource } from "../portfolio/read-action";
import type { ReadArgs, Resource } from "../portfolio/resources";

const definitions = [
  ["sma", [20]],
  ["ema", [50]],
  ["bb", [20, 2]],
  ["rsi", [14]],
  ["macd", [12, 26, 9]],
  ["atr", [14]],
] as const;

export function IndicatorControls({
  args,
  onChange,
}: {
  args: ReadArgs;
  onChange: (series: Resource<"indicators"> | null) => void;
}) {
  const [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <form
      className="oi-form"
      aria-busy={pending}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const spec = definitions
          .filter(([name]) => data.has(name))
          .map(([name, values]) =>
            [name, ...values.map((_, i) => data.get(`${name}-${i}`))].join(":"),
          );
        if (!spec.length) {
          onChange(null);
          return;
        }
        setPending(true);
        setFailed(false);
        try {
          onChange(await readResource("indicators", { ...args, spec }));
        } catch {
          setFailed(true);
        } finally {
          setPending(false);
        }
      }}
    >
      <h2>{m.indicatorParameters}</h2>
      <p>{m.indicatorMeaning}</p>
      {definitions.map(([name, values]) => (
        <fieldset key={name}>
          <legend>{name.toUpperCase()}</legend>
          <Explainer termKey={name} term={name.toUpperCase()} />
          <label>
            <input name={name} type="checkbox" />
            {name.toUpperCase()}
          </label>
          {values.map((value, index) => {
            const label =
              name === "macd"
                ? [m.fast, m.slow, m.smoothing][index]
                : index === 1
                  ? m.width
                  : m.period;
            return (
              <label key={label}>
                {label}
                <input
                  type="number"
                  name={`${name}-${index}`}
                  min={name === "bb" && index === 1 ? "0" : "1"}
                  max={name === "bb" && index === 1 ? "9.9" : "999"}
                  step={name === "bb" && index === 1 ? "0.1" : "1"}
                  defaultValue={value}
                  required
                />
              </label>
            );
          })}
        </fieldset>
      ))}
      {failed && <p role="alert">{p.failed}</p>}
      <button className="oi-button" disabled={pending} type="submit">
        {m.calculate}
      </button>
    </form>
  );
}
