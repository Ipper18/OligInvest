import { expect, test } from "vitest";
import { quietUntil, deliveryChannels } from "../src/delivery-policy.js";

test("quiet hours cross midnight and respect Warsaw DST", () => {
  const quiet = {start:"22:00",end:"07:00"};
  expect(quietUntil("2026-10-24T21:30:00Z","Europe/Warsaw",quiet)).toBe("2026-10-25T06:00:00.000Z");
  expect(quietUntil("2026-03-28T22:30:00Z","Europe/Warsaw",quiet)).toBe("2026-03-29T05:00:00.000Z");
  expect(quietUntil("2026-10-23T12:00:00Z","Europe/Warsaw",quiet)).toBeNull();
  expect(quietUntil("2026-10-23T12:00:00Z","Europe/Warsaw",null)).toBeNull();
});
test("same-day quiet hours and equal endpoints", () => {
  expect(quietUntil("2026-10-23T10:00:00Z","UTC",{start:"09:00",end:"11:00"})).toBe("2026-10-23T11:00:00.000Z");
  expect(quietUntil("2026-10-23T10:00:00Z","UTC",{start:"09:00",end:"09:00"})).toBeNull();
});
test("push fallback respects channel preferences", () => {
  const preferences = {channels:{push:true,email:true},emailFallback:true};
  expect(deliveryChannels(["push"],preferences,false)).toEqual(["email"]);
  expect(deliveryChannels(["push","email"],preferences,false)).toEqual(["email"]);
  expect(deliveryChannels(["push"],preferences,true)).toEqual(["push"]);
  expect(deliveryChannels(["push"],{...preferences,emailFallback:false},false)).toEqual([]);
  expect(deliveryChannels(["push"],{...preferences,channels:{push:true,email:false}},false)).toEqual([]);
});
