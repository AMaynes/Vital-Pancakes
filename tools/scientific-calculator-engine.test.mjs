import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  CalculatorExpressionError,
  configureCalculatorMath,
  evaluateScientificExpression,
  normalizeAngleMode,
} from "./scientific-calculator-engine.mjs";

const require = createRequire(import.meta.url);
const math = configureCalculatorMath(require("../vendor/mathjs-15.2.0.min.js"));

function calculate(expression, options) {
  return evaluateScientificExpression(math, expression, options).display;
}

test("PEMDAS, nested parentheses, and right-associative powers are correct", () => {
  assert.equal(calculate("2 + 3 * 4"), "14");
  assert.equal(calculate("(2 + 3) * 4"), "20");
  assert.equal(calculate("2 ^ 3 ^ 2"), "512");
  assert.equal(calculate("-2 ^ 2"), "-4");
  assert.equal(calculate("(-2) ^ 2"), "4");
});

test("implicit multiplication, modulo, factorial, and roots work", () => {
  assert.equal(calculate("2(3 + 4)"), "14");
  assert.equal(calculate("2 pi"), "6.283185307179586");
  assert.equal(calculate("10 mod 3"), "1");
  assert.equal(calculate("6! / (3! * 3!)"), "20");
  assert.equal(calculate("sqrt(81) + cbrt(27)"), "12");
});

test("decimal arithmetic uses high precision", () => {
  assert.equal(calculate("0.1 + 0.2"), "0.3");
  assert.equal(calculate("1 / 3"), "0.3333333333333333");
  assert.equal(calculate("percent(12.5)"), "0.125");
});

test("trigonometry respects degree, radian, and gradian modes", () => {
  assert.equal(calculate("sin(30)", { angleMode: "deg" }), "0.5");
  assert.equal(calculate("asin(0.5)", { angleMode: "deg" }), "30");
  assert.equal(calculate("sin(pi / 2)", { angleMode: "rad" }), "1");
  assert.equal(calculate("cos(100)", { angleMode: "grad" }), "0");
});

test("answers can be reused without losing precision", () => {
  const first = evaluateScientificExpression(math, "1 / 7");
  assert.equal(
    evaluateScientificExpression(math, "ans * 7", { ans: first.value }).display,
    "1",
  );
});

test("unsafe or non-scalar math.js expression features are rejected", () => {
  for (const expression of [
    "x = 3",
    "[1, 2, 3]",
    "sqrt.constructor",
    "import({})",
    "unknown(2)",
  ]) {
    assert.throws(
      () => calculate(expression),
      (error) => error instanceof CalculatorExpressionError,
      expression,
    );
  }
});

test("invalid arithmetic reports useful errors", () => {
  assert.throws(
    () => calculate("2 * (3 +"),
    (error) => error.code === "syntax-error" && /parentheses/i.test(error.message),
  );
  assert.throws(
    () => calculate("1 / 0"),
    (error) => error.code === "non-finite-result",
  );
  assert.throws(
    () => calculate("sqrt(-1)"),
    (error) => error.code === "domain-error",
  );
});

test("angle modes normalize safely", () => {
  assert.equal(normalizeAngleMode("RAD"), "rad");
  assert.equal(normalizeAngleMode("anything"), "deg");
});
