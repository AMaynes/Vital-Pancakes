/**
 * Pure budgeting, investment-growth, and loan-amortization calculations.
 */

export const BUDGET_FREQUENCIES = Object.freeze({
  ONCE: "once",
  DAILY: "daily",
  WEEKLY: "weekly",
  BIWEEKLY: "biweekly",
  SEMIMONTHLY: "semimonthly",
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  ANNUALLY: "annually",
});

const DAY_MS = 86_400_000;
const MAX_PROJECTION_YEARS = 100;
const MAX_BUDGET_ITEMS = 500;
const MAX_LOAN_PERIODS = 2_400;

export class FinanceInputError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "FinanceInputError";
    this.field = field;
  }
}

/**
 * Projects recurring income and expenses over an inclusive date window.
 *
 * @param {Array<object>} items Budget entries.
 * @param {{startDate: string, endDate: string}} range Projection dates.
 * @returns {{grossIncome: number, grossExpenses: number, net: number, rows: Array<object>}}
 */
export function calculateBudgetProjection(items, range) {
  const start = parseDate(range?.startDate, "startDate");
  const end = parseDate(range?.endDate, "endDate");
  validateProjectionRange(start, end);

  if (!Array.isArray(items)) throw new FinanceInputError("Budget entries must be a list.");
  if (items.length > MAX_BUDGET_ITEMS) {
    throw new FinanceInputError(`A budget can contain at most ${MAX_BUDGET_ITEMS} entries.`);
  }

  const rows = items.map((item, index) => {
    const normalized = normalizeBudgetItem(item, index);
    const occurrences = countOccurrences(normalized, start, end);
    return {
      ...normalized,
      occurrences,
      total: roundMoney(normalized.amount * occurrences),
    };
  });

  const grossIncome = roundMoney(rows
    .filter((row) => row.type === "income")
    .reduce((total, row) => total + row.total, 0));
  const grossExpenses = roundMoney(rows
    .filter((row) => row.type === "expense")
    .reduce((total, row) => total + row.total, 0));

  return {
    grossIncome,
    grossExpenses,
    net: roundMoney(grossIncome - grossExpenses),
    rows,
  };
}

/**
 * Produces monthly amortized investment growth and annual summaries.
 *
 * @param {object} input Investment assumptions.
 * @returns {object} Growth totals and schedule.
 */
export function calculateInvestmentGrowth(input) {
  const principal = readNumber(input?.principal, "principal", { min: 0, max: 1e15 });
  const monthlyContribution = readNumber(input?.monthlyContribution, "monthlyContribution", {
    min: 0,
    max: 1e12,
  });
  const annualRate = readNumber(input?.annualRate, "annualRate", { min: -99.999, max: 1_000 });
  const years = readNumber(input?.years, "years", { min: 1 / 12, max: MAX_PROJECTION_YEARS });
  const compoundsPerYear = readInteger(input?.compoundsPerYear, "compoundsPerYear", {
    allowed: [1, 4, 12, 365],
  });
  const contributionTiming = input?.contributionTiming === "beginning" ? "beginning" : "end";
  const months = Math.max(1, Math.round(years * 12));
  const monthlyRate = Math.pow(
    1 + (annualRate / 100) / compoundsPerYear,
    compoundsPerYear / 12,
  ) - 1;

  let balance = principal;
  let totalContributions = principal;
  let totalGrowth = 0;
  let yearContributions = principal;
  let yearGrowth = 0;
  const schedule = [];

  for (let month = 1; month <= months; month += 1) {
    if (contributionTiming === "beginning") {
      balance += monthlyContribution;
      totalContributions += monthlyContribution;
      yearContributions += monthlyContribution;
    }

    const growth = balance * monthlyRate;
    balance += growth;
    totalGrowth += growth;
    yearGrowth += growth;

    if (contributionTiming === "end") {
      balance += monthlyContribution;
      totalContributions += monthlyContribution;
      yearContributions += monthlyContribution;
    }

    if (month % 12 === 0 || month === months) {
      schedule.push({
        year: Math.ceil(month / 12),
        month,
        contributions: roundMoney(yearContributions),
        growth: roundMoney(yearGrowth),
        endingBalance: roundMoney(balance),
      });
      yearContributions = 0;
      yearGrowth = 0;
    }
  }

  return {
    principal: roundMoney(principal),
    monthlyContribution: roundMoney(monthlyContribution),
    totalContributions: roundMoney(totalContributions),
    totalGrowth: roundMoney(totalGrowth),
    endingBalance: roundMoney(balance),
    months,
    effectiveAnnualRate: ((1 + monthlyRate) ** 12 - 1) * 100,
    schedule,
  };
}

/**
 * Builds a rounded payment-by-payment fixed-rate loan schedule.
 *
 * @param {object} input Loan assumptions.
 * @returns {object} Payment totals and schedule.
 */
export function calculateLoanAmortization(input) {
  const principal = readNumber(input?.principal, "principal", { minExclusive: 0, max: 1e15 });
  const annualRate = readNumber(input?.annualRate, "annualRate", { min: 0, max: 1_000 });
  const years = readNumber(input?.years, "years", { min: 1 / 365, max: MAX_PROJECTION_YEARS });
  const paymentsPerYear = readInteger(input?.paymentsPerYear, "paymentsPerYear", {
    allowed: [1, 4, 12, 24, 26, 52],
  });
  const extraPayment = readNumber(input?.extraPayment, "extraPayment", { min: 0, max: 1e12 });
  const scheduledPeriods = Math.max(1, Math.round(years * paymentsPerYear));
  if (scheduledPeriods > MAX_LOAN_PERIODS) {
    throw new FinanceInputError("The loan schedule has too many payment periods.", "years");
  }

  const periodicRate = (annualRate / 100) / paymentsPerYear;
  const rawPayment = periodicRate === 0
    ? principal / scheduledPeriods
    : principal * periodicRate / (1 - (1 + periodicRate) ** -scheduledPeriods);
  const regularPayment = roundMoney(rawPayment);
  const plannedPayment = roundMoney(regularPayment + extraPayment);

  let balance = roundMoney(principal);
  let totalInterest = 0;
  let totalPaid = 0;
  const schedule = [];

  for (let period = 1; balance > 0 && period <= scheduledPeriods; period += 1) {
    const interest = roundMoney(balance * periodicRate);
    const remainingDue = roundMoney(balance + interest);
    const payment = period === scheduledPeriods
      ? remainingDue
      : Math.min(plannedPayment, remainingDue);
    const principalPaid = roundMoney(payment - interest);
    balance = roundMoney(Math.max(0, balance - principalPaid));
    totalInterest = roundMoney(totalInterest + interest);
    totalPaid = roundMoney(totalPaid + payment);

    schedule.push({
      period,
      payment,
      principal: principalPaid,
      interest,
      balance,
    });
  }

  return {
    principal: roundMoney(principal),
    regularPayment,
    extraPayment: roundMoney(extraPayment),
    plannedPayment,
    numberOfPayments: schedule.length,
    payoffYears: schedule.length / paymentsPerYear,
    totalInterest,
    totalPaid,
    schedule,
  };
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeBudgetItem(item, index) {
  const type = item?.type === "expense" ? "expense" : "income";
  const frequency = Object.values(BUDGET_FREQUENCIES).includes(item?.frequency)
    ? item.frequency
    : BUDGET_FREQUENCIES.MONTHLY;
  const startDate = parseDate(item?.startDate, `items[${index}].startDate`);
  const endDate = item?.endDate ? parseDate(item.endDate, `items[${index}].endDate`) : null;
  if (endDate && endDate < startDate) {
    throw new FinanceInputError("An entry end date cannot be before its start date.", `items[${index}].endDate`);
  }

  return {
    id: typeof item?.id === "string" ? item.id : `budget-item-${index}`,
    name: String(item?.name ?? "").trim().slice(0, 100) || (type === "income" ? "Income" : "Expense"),
    type,
    amount: roundMoney(readNumber(item?.amount, `items[${index}].amount`, { min: 0, max: 1e15 })),
    frequency,
    startDate: formatDate(startDate),
    endDate: endDate ? formatDate(endDate) : "",
  };
}

function countOccurrences(item, projectionStart, projectionEnd) {
  const itemStart = parseDate(item.startDate);
  const itemEnd = item.endDate ? parseDate(item.endDate) : projectionEnd;
  const start = new Date(Math.max(itemStart.getTime(), projectionStart.getTime()));
  const end = new Date(Math.min(itemEnd.getTime(), projectionEnd.getTime()));
  if (start > end) return 0;

  switch (item.frequency) {
    case BUDGET_FREQUENCIES.ONCE:
      return itemStart >= start && itemStart <= end ? 1 : 0;
    case BUDGET_FREQUENCIES.DAILY:
      return countFixedDayOccurrences(itemStart, start, end, 1);
    case BUDGET_FREQUENCIES.WEEKLY:
      return countFixedDayOccurrences(itemStart, start, end, 7);
    case BUDGET_FREQUENCIES.BIWEEKLY:
      return countFixedDayOccurrences(itemStart, start, end, 14);
    case BUDGET_FREQUENCIES.SEMIMONTHLY:
      return countSemimonthlyOccurrences(itemStart, start, end);
    case BUDGET_FREQUENCIES.QUARTERLY:
      return countMonthlyOccurrences(itemStart, start, end, 3);
    case BUDGET_FREQUENCIES.ANNUALLY:
      return countMonthlyOccurrences(itemStart, start, end, 12);
    case BUDGET_FREQUENCIES.MONTHLY:
    default:
      return countMonthlyOccurrences(itemStart, start, end, 1);
  }
}

function countFixedDayOccurrences(anchor, start, end, intervalDays) {
  const elapsedDays = Math.ceil((start - anchor) / DAY_MS);
  const firstIndex = Math.max(0, Math.ceil(elapsedDays / intervalDays));
  const first = new Date(anchor.getTime() + firstIndex * intervalDays * DAY_MS);
  if (first > end) return 0;
  return Math.floor((end - first) / (intervalDays * DAY_MS)) + 1;
}

function countMonthlyOccurrences(anchor, start, end, intervalMonths) {
  let count = 0;
  for (let index = 0; index <= MAX_PROJECTION_YEARS * 12; index += intervalMonths) {
    const occurrence = addMonths(anchor, index);
    if (occurrence > end) break;
    if (occurrence >= start) count += 1;
  }
  return count;
}

function countSemimonthlyOccurrences(anchor, start, end) {
  let count = 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    for (const day of [1, 15]) {
      const occurrence = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), day));
      if (occurrence >= anchor && occurrence >= start && occurrence <= end) count += 1;
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return count;
}

function addMonths(anchor, months) {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const day = anchor.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function parseDate(value, field = "date") {
  const source = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    throw new FinanceInputError("Enter a valid date.", field);
  }
  const date = new Date(`${source}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== source) {
    throw new FinanceInputError("Enter a valid date.", field);
  }
  return date;
}

function validateProjectionRange(start, end) {
  if (end < start) throw new FinanceInputError("The projection end date must follow its start date.", "endDate");
  const years = (end - start) / (DAY_MS * 365.2425);
  if (years > MAX_PROJECTION_YEARS) {
    throw new FinanceInputError(`Projection windows are limited to ${MAX_PROJECTION_YEARS} years.`, "endDate");
  }
}

function readNumber(value, field, limits = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new FinanceInputError("Enter a valid number.", field);
  if (limits.min !== undefined && number < limits.min) {
    throw new FinanceInputError(`Enter a value of at least ${limits.min}.`, field);
  }
  if (limits.minExclusive !== undefined && number <= limits.minExclusive) {
    throw new FinanceInputError(`Enter a value greater than ${limits.minExclusive}.`, field);
  }
  if (limits.max !== undefined && number > limits.max) {
    throw new FinanceInputError(`Enter a value no greater than ${limits.max}.`, field);
  }
  return number;
}

function readInteger(value, field, options = {}) {
  const number = readNumber(value, field);
  if (!Number.isInteger(number) || (options.allowed && !options.allowed.includes(number))) {
    throw new FinanceInputError("Choose a supported frequency.", field);
  }
  return number;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
