import assert from "node:assert/strict";
import test from "node:test";

import {
  FinanceInputError,
  calculateBudgetProjection,
  calculateInvestmentGrowth,
  calculateLoanAmortization,
} from "./budget-finance-model.mjs";

test("budget projections count actual recurring dates and report gross and net totals", () => {
  const result = calculateBudgetProjection([
    {
      id: "salary",
      name: "Salary",
      type: "income",
      amount: 2_000,
      frequency: "semimonthly",
      startDate: "2026-01-01",
      endDate: "",
    },
    {
      id: "rent",
      name: "Rent",
      type: "expense",
      amount: 1_500,
      frequency: "monthly",
      startDate: "2026-01-01",
      endDate: "",
    },
    {
      id: "annual-fee",
      name: "Annual fee",
      type: "expense",
      amount: 120,
      frequency: "once",
      startDate: "2026-06-10",
      endDate: "",
    },
  ], {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });

  assert.equal(result.rows[0].occurrences, 24);
  assert.equal(result.rows[1].occurrences, 12);
  assert.equal(result.rows[2].occurrences, 1);
  assert.equal(result.grossIncome, 48_000);
  assert.equal(result.grossExpenses, 18_120);
  assert.equal(result.net, 29_880);
});

test("monthly recurrence preserves end-of-month anchors", () => {
  const result = calculateBudgetProjection([{
    type: "expense",
    amount: 100,
    frequency: "monthly",
    startDate: "2026-01-31",
  }], {
    startDate: "2026-02-01",
    endDate: "2026-04-30",
  });

  assert.equal(result.rows[0].occurrences, 3);
  assert.equal(result.grossExpenses, 300);
});

test("entry and projection boundaries are validated", () => {
  assert.throws(
    () => calculateBudgetProjection([], { startDate: "2026-12-31", endDate: "2026-01-01" }),
    (error) => error instanceof FinanceInputError && error.field === "endDate",
  );
  assert.throws(
    () => calculateBudgetProjection([{
      amount: 1,
      startDate: "2026-04-01",
      endDate: "2026-03-01",
    }], { startDate: "2026-01-01", endDate: "2026-12-31" }),
    FinanceInputError,
  );
});

test("investment growth amortizes compound returns and monthly contributions", () => {
  const result = calculateInvestmentGrowth({
    principal: 10_000,
    monthlyContribution: 500,
    annualRate: 6,
    years: 10,
    compoundsPerYear: 12,
    contributionTiming: "end",
  });

  assert.equal(result.months, 120);
  assert.equal(result.totalContributions, 70_000);
  assert.equal(result.schedule.length, 10);
  assert.equal(result.endingBalance, 100_133.64);
  assert.equal(result.totalGrowth, 30_133.64);
});

test("beginning-of-month contributions earn more than end-of-month contributions", () => {
  const input = {
    principal: 0,
    monthlyContribution: 100,
    annualRate: 12,
    years: 1,
    compoundsPerYear: 12,
  };
  const beginning = calculateInvestmentGrowth({ ...input, contributionTiming: "beginning" });
  const end = calculateInvestmentGrowth({ ...input, contributionTiming: "end" });
  assert.ok(beginning.endingBalance > end.endingBalance);
  assert.equal(end.totalContributions, 1_200);
});

test("zero-rate investments retain contributions without growth", () => {
  const result = calculateInvestmentGrowth({
    principal: 1_000,
    monthlyContribution: 100,
    annualRate: 0,
    years: 1,
    compoundsPerYear: 12,
  });
  assert.equal(result.endingBalance, 2_200);
  assert.equal(result.totalGrowth, 0);
});

test("loan amortization matches a standard fixed-rate mortgage payment", () => {
  const result = calculateLoanAmortization({
    principal: 300_000,
    annualRate: 6.5,
    years: 30,
    paymentsPerYear: 12,
    extraPayment: 0,
  });

  assert.equal(result.regularPayment, 1_896.2);
  assert.equal(result.numberOfPayments, 360);
  assert.equal(result.schedule.at(-1).balance, 0);
  assert.equal(result.totalPaid, 682_636.71);
  assert.equal(result.totalInterest, 382_636.71);
});

test("extra loan payments shorten payoff and reduce total interest", () => {
  const base = {
    principal: 250_000,
    annualRate: 5.5,
    years: 30,
    paymentsPerYear: 12,
  };
  const standard = calculateLoanAmortization({ ...base, extraPayment: 0 });
  const accelerated = calculateLoanAmortization({ ...base, extraPayment: 250 });

  assert.ok(accelerated.numberOfPayments < standard.numberOfPayments);
  assert.ok(accelerated.totalInterest < standard.totalInterest);
  assert.equal(accelerated.schedule.at(-1).balance, 0);
});

test("zero-interest loans split principal evenly", () => {
  const result = calculateLoanAmortization({
    principal: 12_000,
    annualRate: 0,
    years: 1,
    paymentsPerYear: 12,
    extraPayment: 0,
  });
  assert.equal(result.regularPayment, 1_000);
  assert.equal(result.totalInterest, 0);
  assert.equal(result.totalPaid, 12_000);
});
