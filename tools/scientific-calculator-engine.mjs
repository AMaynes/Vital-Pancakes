/**
 * Safe scalar scientific-calculator behavior built on math.js.
 *
 * The public evaluator accepts arithmetic expressions only. Assignments,
 * collections, property access, and arbitrary math.js helpers are rejected
 * before compilation.
 */

export const ANGLE_MODES = Object.freeze({
  DEG: "deg",
  RAD: "rad",
  GRAD: "grad",
});

const ALLOWED_NODE_TYPES = new Set([
  "ConstantNode",
  "FunctionNode",
  "OperatorNode",
  "ParenthesisNode",
  "SymbolNode",
]);

const ALLOWED_OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "^",
  "%",
  "mod",
  "!",
]);

const ALLOWED_FUNCTIONS = new Set([
  "abs",
  "acos",
  "acosh",
  "acot",
  "acoth",
  "acsc",
  "acsch",
  "asec",
  "asech",
  "asin",
  "asinh",
  "atan",
  "atan2",
  "atanh",
  "cbrt",
  "ceil",
  "combinations",
  "cos",
  "cosh",
  "cot",
  "coth",
  "csc",
  "csch",
  "exp",
  "factorial",
  "floor",
  "gamma",
  "gcd",
  "hypot",
  "lcm",
  "ln",
  "log",
  "log10",
  "log2",
  "max",
  "min",
  "mod",
  "nthRoot",
  "percent",
  "permutations",
  "pow",
  "round",
  "sec",
  "sech",
  "sign",
  "sin",
  "sinh",
  "sqrt",
  "tan",
  "tanh",
]);

const ALLOWED_CONSTANTS = new Set([
  "ans",
  "e",
  "pi",
  "tau",
]);

const DIRECT_TRIG_FUNCTIONS = ["sin", "cos", "tan", "cot", "sec", "csc"];
const INVERSE_TRIG_FUNCTIONS = ["asin", "acos", "atan", "acot", "asec", "acsc"];
const MAX_EXPRESSION_LENGTH = 500;
const MAX_EXPRESSION_NODES = 250;

export class CalculatorExpressionError extends Error {
  constructor(message, code = "invalid-expression") {
    super(message);
    this.name = "CalculatorExpressionError";
    this.code = code;
  }
}

/**
 * Configures the bundled math.js singleton for precise decimal arithmetic.
 *
 * @param {object} math math.js browser API.
 * @returns {object} The configured API.
 */
export function configureCalculatorMath(math) {
  if (!math || typeof math.parse !== "function" || typeof math.config !== "function") {
    throw new TypeError("A complete math.js API is required.");
  }

  math.config({
    number: "BigNumber",
    numberFallback: "BigNumber",
    precision: 64,
    predictable: true,
  });
  return math;
}

/**
 * Evaluates one safe, real-valued scientific expression.
 *
 * @param {object} math Configured math.js API.
 * @param {string} expression User expression.
 * @param {{angleMode?: string, ans?: unknown}} options Evaluation settings.
 * @returns {{display: string, value: unknown}}
 */
export function evaluateScientificExpression(math, expression, options = {}) {
  const source = String(expression ?? "").trim();
  if (!source) {
    throw new CalculatorExpressionError("Enter an expression.", "empty-expression");
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculatorExpressionError("The expression is too long.", "expression-too-long");
  }

  const angleMode = normalizeAngleMode(options.angleMode);
  let node;
  try {
    node = math.parse(source);
  } catch (error) {
    throw new CalculatorExpressionError(
      normalizeMathError(error, "Check the expression and its parentheses."),
      "syntax-error",
    );
  }

  validateExpressionTree(node);

  try {
    const value = node.compile().evaluate(createEvaluationScope(math, angleMode, options.ans));
    validateResult(math, value);
    return {
      display: formatCalculatorValue(math, value),
      value,
    };
  } catch (error) {
    if (error instanceof CalculatorExpressionError) throw error;
    throw new CalculatorExpressionError(
      normalizeMathError(error, "This expression cannot be calculated."),
      "evaluation-error",
    );
  }
}

/**
 * Formats a finite scalar result for the calculator display.
 *
 * @param {object} math Configured math.js API.
 * @param {unknown} value Scalar numeric result.
 * @returns {string}
 */
export function formatCalculatorValue(math, value) {
  if (math.equal(value, 0)) return "0";
  return math.format(value, {
    notation: "auto",
    precision: 16,
    lowerExp: -10,
    upperExp: 16,
  });
}

export function normalizeAngleMode(value) {
  const normalized = String(value ?? "").toLowerCase();
  return Object.values(ANGLE_MODES).includes(normalized) ? normalized : ANGLE_MODES.DEG;
}

function validateExpressionTree(root) {
  let nodeCount = 0;

  root.traverse((node) => {
    nodeCount += 1;
    if (nodeCount > MAX_EXPRESSION_NODES) {
      throw new CalculatorExpressionError("The expression is too complex.", "expression-too-complex");
    }
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      throw new CalculatorExpressionError(
        "Only scalar calculations are allowed.",
        "unsupported-syntax",
      );
    }
    if (node.type === "OperatorNode" && !ALLOWED_OPERATORS.has(node.op)) {
      throw new CalculatorExpressionError(
        `The ${node.op} operator is not supported.`,
        "unsupported-operator",
      );
    }
    if (node.type === "FunctionNode") {
      const functionName = node.fn?.name;
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new CalculatorExpressionError(
          `${functionName || "That function"} is not available in this calculator.`,
          "unsupported-function",
        );
      }
    }
    if (
      node.type === "SymbolNode"
      && !ALLOWED_CONSTANTS.has(node.name)
      && !ALLOWED_FUNCTIONS.has(node.name)
    ) {
      throw new CalculatorExpressionError(
        `${node.name} is not a recognized constant or function.`,
        "unknown-symbol",
      );
    }
  });
}

function createEvaluationScope(math, angleMode, ans) {
  const scope = new Map();
  const inputAngle = (value) => math.multiply(value, angleScale(math, angleMode));
  const outputAngle = (value) => math.divide(value, angleScale(math, angleMode));

  scope.set("ans", normalizeAnswer(math, ans));
  scope.set("tau", math.multiply(math.pi, 2));
  scope.set("ln", math.log);
  scope.set("percent", (value) => math.divide(value, 100));

  if (angleMode !== ANGLE_MODES.RAD) {
    DIRECT_TRIG_FUNCTIONS.forEach((name) => {
      scope.set(name, (value) => math[name](inputAngle(value)));
    });
    INVERSE_TRIG_FUNCTIONS.forEach((name) => {
      scope.set(name, (value) => outputAngle(math[name](value)));
    });
    scope.set("atan2", (y, x) => outputAngle(math.atan2(y, x)));
  }

  return scope;
}

function angleScale(math, angleMode) {
  if (angleMode === ANGLE_MODES.DEG) return math.divide(math.pi, 180);
  if (angleMode === ANGLE_MODES.GRAD) return math.divide(math.pi, 200);
  return math.bignumber(1);
}

function normalizeAnswer(math, ans) {
  if (ans === undefined || ans === null || ans === "") return math.bignumber(0);
  if (math.isBigNumber(ans)) return ans;
  try {
    return math.bignumber(String(ans));
  } catch {
    return math.bignumber(0);
  }
}

function validateResult(math, value) {
  const type = math.typeOf(value);
  if (type !== "number" && type !== "BigNumber") {
    throw new CalculatorExpressionError("The result is not a real scalar number.", "non-scalar-result");
  }
  if (math.isNaN(value)) {
    throw new CalculatorExpressionError(
      "That value is outside the function's real domain.",
      "domain-error",
    );
  }
  if (!math.isFinite(value)) {
    throw new CalculatorExpressionError(
      "The result is undefined or outside the calculator's range.",
      "non-finite-result",
    );
  }
}

function normalizeMathError(error, fallback) {
  const message = String(error?.message ?? "").replace(/\s*\(char \d+\)\s*$/i, "").trim();
  if (!message) return fallback;
  if (/parenthesis|unexpected end|unexpected part/i.test(message)) return fallback;
  if (/division by zero|divide by zero/i.test(message)) return "Division by zero is undefined.";
  if (/positive integer|nonnegative integer|factorial/i.test(message)) {
    return "Factorial requires a nonnegative whole number.";
  }
  if (/domain|complex|real number/i.test(message)) return "That value is outside the function's real domain.";
  return message;
}
