﻿import * as Utils from "../src/utils";

test("lerp", () => {
    expect(Utils.lerp(-5, 5, 0)).toBe(-5);
    expect(Utils.lerp(-5, 5, 0.5)).toBe(0);
    expect(Utils.lerp(-5, 5, 1)).toBe(5);
    expect(Utils.lerp(0, 1, 2)).toBe(2);
    expect(Utils.lerp(0, 1, -2)).toBe(-2);
});

test("clamp", () => {
    expect(Utils.clamp(2, -5, 5)).toBe(2);
    expect(Utils.clamp(-7, -5, 5)).toBe(-5);
    expect(Utils.clamp(7, -5, 5)).toBe(5);
});

test("half", () => {
    expect(Utils.half(2)).toBe(1);
    expect(Utils.half(10)).toBe(5);
});

test("add", () => {
    expect(Utils.add(1, 5)).toBe(6);
});

test("subtract", () => {
    expect(Utils.subtract(5, 1)).toBe(4);
});
