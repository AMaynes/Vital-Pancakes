import {
  BUDGET_FREQUENCIES,
  FinanceInputError,
  calculateBudgetProjection,
  calculateInvestmentGrowth,
  calculateLoanAmortization,
} from "./budget-finance-model.mjs?v=1";
import {
  IRS_STATE_DIRECTORY_URL,
  STATE_JURISDICTIONS,
  STATE_TAX_CATEGORIES,
  TAX_DIRECTORY_REVIEWED_DATE,
  createTaxDirectory,
  searchTaxDirectory,
} from "./tax-directory.mjs?v=1";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
} from "./current-tool-ai-adapter.mjs";

const STORAGE_KEY = "vital-pancakes-budget-finance-v1";
const TAB_NAMES = ["budget", "investment", "loan", "tax"];
const TAX_RESULT_LIMIT = 100;
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const tabButtons = [...document.querySelectorAll("[data-finance-tab]")];
const panels = new Map(TAB_NAMES.map((name) => [
  name,
  document.querySelector(`#finance-panel-${name}`),
]));
const saveStatus = document.querySelector("#finance-save-status");
const budgetStartDate = document.querySelector("#budget-start-date");
const budgetEndDate = document.querySelector("#budget-end-date");
const budgetRows = document.querySelector("#budget-rows");
const budgetEmpty = document.querySelector("#budget-empty");
const budgetError = document.querySelector("#budget-error");
const budgetGrossIncome = document.querySelector("#budget-gross-income");
const budgetGrossExpenses = document.querySelector("#budget-gross-expenses");
const budgetNetTotal = document.querySelector("#budget-net-total");
const budgetNetCard = document.querySelector("#budget-net-card");
const investmentForm = document.querySelector("#investment-form");
const investmentError = document.querySelector("#investment-error");
const investmentSchedule = document.querySelector("#investment-schedule");
const loanForm = document.querySelector("#loan-form");
const loanError = document.querySelector("#loan-error");
const loanSchedule = document.querySelector("#loan-schedule");
const loanScheduleView = document.querySelector("#loan-schedule-view");
const loanPeriodHeading = document.querySelector("#loan-period-heading");
const taxSearch = document.querySelector("#tax-search");
const taxJurisdiction = document.querySelector("#tax-jurisdiction");
const taxCategory = document.querySelector("#tax-category");
const taxResults = document.querySelector("#tax-results");
const taxEmpty = document.querySelector("#tax-empty");
const taxResultCount = document.querySelector("#tax-result-count");
const taxDirectory = createTaxDirectory();

let state = loadState();
let formRenderTimer = null;

initializeTabs();
initializeBudget();
initializeInvestment();
initializeLoan();
initializeTaxFinder();
activateTab(getInitialTab(), { updateUrl: false });

function initializeTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.financeTab));
  });
  document.querySelector(".finance-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabButtons.findIndex((button) => button.getAttribute("aria-selected") === "true");
    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabButtons.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabButtons.length - 1;
    tabButtons[nextIndex].focus();
    activateTab(tabButtons[nextIndex].dataset.financeTab);
  });
}

function activateTab(name, options = {}) {
  const tabName = TAB_NAMES.includes(name) ? name : "budget";
  state.activeTab = tabName;
  tabButtons.forEach((button) => {
    const active = button.dataset.financeTab === tabName;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  panels.forEach((panel, panelName) => {
    panel.hidden = panelName !== tabName;
  });
  persistState();
  if (options.updateUrl !== false) history.replaceState(null, "", `#${tabName}`);
}

function initializeBudget() {
  budgetStartDate.value = state.budget.startDate;
  budgetEndDate.value = state.budget.endDate;
  budgetStartDate.addEventListener("change", updateBudgetRange);
  budgetEndDate.addEventListener("change", updateBudgetRange);
  document.querySelector("#add-budget-income").addEventListener("click", () => addBudgetItem("income"));
  document.querySelector("#add-budget-expense").addEventListener("click", () => addBudgetItem("expense"));
  budgetRows.addEventListener("input", handleBudgetRowInput);
  budgetRows.addEventListener("change", handleBudgetRowChange);
  budgetRows.addEventListener("click", handleBudgetRowClick);
  renderBudget();
}

function updateBudgetRange() {
  state.budget.startDate = budgetStartDate.value;
  state.budget.endDate = budgetEndDate.value;
  persistState();
  renderBudget();
}

function addBudgetItem(type) {
  state.budget.items.push({
    id: globalThis.crypto?.randomUUID?.() ?? `budget-${Date.now()}`,
    type,
    name: type === "income" ? "Income" : "Expense",
    amount: 0,
    frequency: BUDGET_FREQUENCIES.MONTHLY,
    startDate: state.budget.startDate,
    endDate: "",
  });
  persistState();
  renderBudget();
  budgetRows.querySelector("tr:last-child input[data-budget-field='name']")?.select();
}

function handleBudgetRowChange(event) {
  const control = event.target.closest("[data-budget-id][data-budget-field]");
  if (!control) return;
  updateBudgetItemFromControl(control);
  persistState();
  renderBudget();
}

function handleBudgetRowInput(event) {
  const control = event.target.closest("[data-budget-id][data-budget-field]");
  if (!control) return;
  updateBudgetItemFromControl(control);
  persistState();
  renderBudgetProjectionValues();
}

function updateBudgetItemFromControl(control) {
  const item = state.budget.items.find((entry) => entry.id === control.dataset.budgetId);
  if (!item) return;
  item[control.dataset.budgetField] = control.dataset.budgetField === "amount"
    ? Number(control.value)
    : control.value;
}

function handleBudgetRowClick(event) {
  const button = event.target.closest("[data-delete-budget-id]");
  if (!button) return;
  state.budget.items = state.budget.items.filter((item) => item.id !== button.dataset.deleteBudgetId);
  persistState();
  renderBudget();
}

function renderBudget() {
  budgetRows.replaceChildren();
  budgetEmpty.hidden = state.budget.items.length > 0;
  let projection = null;
  let rowResults = new Map();

  try {
    projection = calculateBudgetProjection(state.budget.items, state.budget);
    rowResults = new Map(projection.rows.map((row) => [row.id, row]));
    hideError(budgetError);
  } catch (error) {
    showError(budgetError, getFinanceError(error));
  }

  state.budget.items.forEach((item) => {
    const result = rowResults.get(item.id);
    const row = document.createElement("tr");
    row.append(
      createBudgetSelectCell(item, "type", [
        ["income", "Income"],
        ["expense", "Expense"],
      ]),
      createBudgetInputCell(item, "name", "text"),
      createBudgetInputCell(item, "amount", "number", { min: "0", step: "0.01" }),
      createBudgetSelectCell(item, "frequency", [
        ["once", "One time"],
        ["daily", "Daily"],
        ["weekly", "Weekly"],
        ["biweekly", "Every 2 weeks"],
        ["semimonthly", "Twice monthly"],
        ["monthly", "Monthly"],
        ["quarterly", "Quarterly"],
        ["annually", "Annually"],
      ]),
      createBudgetInputCell(item, "startDate", "date"),
      createBudgetInputCell(item, "endDate", "date"),
      createBudgetResultCell(item.id, "count", result ? numberFormatter.format(result.occurrences) : "—"),
      createBudgetResultCell(item.id, "total", result ? formatCurrency(result.total) : "—"),
      createBudgetDeleteCell(item),
    );
    budgetRows.append(row);
  });

  updateBudgetTotals(projection);
}

function renderBudgetProjectionValues() {
  try {
    const projection = calculateBudgetProjection(state.budget.items, state.budget);
    const rowResults = new Map(projection.rows.map((row) => [row.id, row]));
    state.budget.items.forEach((item) => {
      const result = rowResults.get(item.id);
      const count = budgetRows.querySelector(`[data-budget-result-id="${CSS.escape(item.id)}"][data-budget-result="count"]`);
      const total = budgetRows.querySelector(`[data-budget-result-id="${CSS.escape(item.id)}"][data-budget-result="total"]`);
      if (count) count.textContent = numberFormatter.format(result?.occurrences ?? 0);
      if (total) total.textContent = formatCurrency(result?.total ?? 0);
    });
    hideError(budgetError);
    updateBudgetTotals(projection);
  } catch (error) {
    showError(budgetError, getFinanceError(error));
  }
}

function createBudgetInputCell(item, field, type, attributes = {}) {
  const cell = document.createElement("td");
  const input = document.createElement("input");
  input.type = type;
  input.value = item[field] ?? "";
  input.dataset.budgetId = item.id;
  input.dataset.budgetField = field;
  input.setAttribute("aria-label", `${field} for ${item.name || item.type}`);
  Object.entries(attributes).forEach(([name, value]) => input.setAttribute(name, value));
  cell.append(input);
  return cell;
}

function createBudgetSelectCell(item, field, options) {
  const cell = document.createElement("td");
  const select = document.createElement("select");
  select.dataset.budgetId = item.id;
  select.dataset.budgetField = field;
  select.setAttribute("aria-label", `${field} for ${item.name || item.type}`);
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = item[field] === value;
    select.append(option);
  });
  cell.append(select);
  return cell;
}

function createBudgetDeleteCell(item) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = "budget-delete";
  button.type = "button";
  button.dataset.deleteBudgetId = item.id;
  button.setAttribute("aria-label", `Delete ${item.name || item.type}`);
  button.title = "Delete entry";
  button.textContent = "×";
  cell.append(button);
  return cell;
}

function createBudgetResultCell(itemId, resultType, value) {
  const cell = createTextCell(value);
  cell.dataset.budgetResultId = itemId;
  cell.dataset.budgetResult = resultType;
  return cell;
}

function updateBudgetTotals(projection) {
  const grossIncome = projection?.grossIncome ?? 0;
  const grossExpenses = projection?.grossExpenses ?? 0;
  const net = projection?.net ?? 0;
  budgetGrossIncome.textContent = formatCurrency(grossIncome);
  budgetGrossExpenses.textContent = formatCurrency(grossExpenses);
  budgetNetTotal.textContent = formatCurrency(net);
  budgetNetCard.classList.toggle("is-negative", net < 0);
}

function initializeInvestment() {
  fillForm(investmentForm, state.investment);
  investmentForm.addEventListener("input", () => {
    state.investment = readFormValues(investmentForm);
    persistState();
    scheduleFormRender(renderInvestment);
  });
  renderInvestment();
}

function renderInvestment() {
  try {
    const result = calculateInvestmentGrowth(state.investment);
    hideError(investmentError);
    setText("#investment-ending", formatCurrency(result.endingBalance));
    setText("#investment-contributions", formatCurrency(result.totalContributions));
    setText("#investment-growth", formatCurrency(result.totalGrowth));
    setText("#investment-effective-rate", `${numberFormatter.format(result.effectiveAnnualRate)}%`);
    investmentSchedule.replaceChildren(...result.schedule.map((row) => createTableRow([
      `Year ${row.year}`,
      formatCurrency(row.contributions),
      formatCurrency(row.growth),
      formatCurrency(row.endingBalance),
    ])));
  } catch (error) {
    showError(investmentError, getFinanceError(error));
  }
}

function initializeLoan() {
  fillForm(loanForm, state.loan);
  loanScheduleView.value = state.loanScheduleView;
  loanForm.addEventListener("input", () => {
    state.loan = readFormValues(loanForm);
    persistState();
    scheduleFormRender(renderLoan);
  });
  loanScheduleView.addEventListener("change", () => {
    state.loanScheduleView = loanScheduleView.value;
    persistState();
    renderLoan();
  });
  renderLoan();
}

function renderLoan() {
  try {
    const result = calculateLoanAmortization(state.loan);
    hideError(loanError);
    setText("#loan-payment", formatCurrency(result.regularPayment));
    setText("#loan-planned-payment", formatCurrency(result.plannedPayment));
    setText("#loan-total-interest", formatCurrency(result.totalInterest));
    setText("#loan-total-paid", formatCurrency(result.totalPaid));
    setText("#loan-payment-count", numberFormatter.format(result.numberOfPayments));
    setText("#loan-payoff-time", formatDuration(result.payoffYears));

    const showPayments = state.loanScheduleView === "payments";
    loanPeriodHeading.textContent = showPayments ? "Payment" : "Year";
    const schedule = showPayments
      ? result.schedule.map((row) => ({
        label: numberFormatter.format(row.period),
        paid: row.payment,
        principal: row.principal,
        interest: row.interest,
        balance: row.balance,
      }))
      : aggregateLoanYears(result.schedule, Number(state.loan.paymentsPerYear));
    loanSchedule.replaceChildren(...schedule.map((row) => createTableRow([
      row.label,
      formatCurrency(row.paid),
      formatCurrency(row.principal),
      formatCurrency(row.interest),
      formatCurrency(row.balance),
    ])));
  } catch (error) {
    showError(loanError, getFinanceError(error));
  }
}

function aggregateLoanYears(schedule, paymentsPerYear) {
  const rows = [];
  for (let index = 0; index < schedule.length; index += paymentsPerYear) {
    const payments = schedule.slice(index, index + paymentsPerYear);
    rows.push({
      label: `Year ${Math.floor(index / paymentsPerYear) + 1}`,
      paid: sum(payments, "payment"),
      principal: sum(payments, "principal"),
      interest: sum(payments, "interest"),
      balance: payments.at(-1).balance,
    });
  }
  return rows;
}

function initializeTaxFinder() {
  taxJurisdiction.append(
    createOption("federal", "Federal"),
    createOption("all", "All jurisdictions"),
    ...STATE_JURISDICTIONS.map((stateItem) => createOption(
      stateItem.code.toLowerCase(),
      `${stateItem.name} (${stateItem.code})`,
    )),
  );
  taxCategory.append(
    createOption("all", "All tax categories"),
    ...STATE_TAX_CATEGORIES.map((categoryItem) => createOption(categoryItem.id, categoryItem.name)),
  );
  taxSearch.value = state.tax.query;
  taxJurisdiction.value = state.tax.jurisdiction;
  taxCategory.value = state.tax.categoryId;
  document.querySelector("#tax-reviewed-date").textContent = `Official sources reviewed ${TAX_DIRECTORY_REVIEWED_DATE}`;
  document.querySelector(".tax-panel .finance-panel-header a").href = IRS_STATE_DIRECTORY_URL;

  [taxSearch, taxJurisdiction, taxCategory].forEach((control) => {
    control.addEventListener("input", updateTaxFilters);
  });
  renderTaxResults();
}

function updateTaxFilters() {
  state.tax = {
    query: taxSearch.value,
    jurisdiction: taxJurisdiction.value,
    categoryId: taxCategory.value,
  };
  persistState();
  renderTaxResults();
}

function renderTaxResults() {
  const matching = searchTaxDirectory(taxDirectory, {
    ...state.tax,
    limit: 500,
  });
  const visible = matching.slice(0, TAX_RESULT_LIMIT);
  taxResults.replaceChildren(...visible.map(createTaxResult));
  taxEmpty.hidden = matching.length > 0;
  taxResultCount.textContent = matching.length > TAX_RESULT_LIMIT
    ? `Showing ${TAX_RESULT_LIMIT} of ${matching.length}${matching.length === 500 ? "+" : ""} resources`
    : `${matching.length} ${matching.length === 1 ? "resource" : "resources"}`;
}

function createTaxResult(record) {
  const item = document.createElement("li");
  item.className = "tax-result";
  const jurisdiction = document.createElement("span");
  jurisdiction.className = "tax-result-jurisdiction";
  jurisdiction.textContent = `${record.jurisdictionName} · ${record.categoryName}`;
  const heading = document.createElement("h3");
  heading.textContent = record.title;
  const description = document.createElement("p");
  description.textContent = record.description;
  const link = document.createElement("a");
  link.href = record.sourceUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${record.sourceLabel} ↗`;
  item.append(jurisdiction, heading, description, link);
  return item;
}

function getInitialTab() {
  const hashTab = location.hash.replace(/^#/, "");
  return TAB_NAMES.includes(hashTab) ? hashTab : state.activeTab;
}

function loadState() {
  const defaults = createDefaultState();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || typeof stored !== "object") return defaults;
    return {
      ...defaults,
      activeTab: TAB_NAMES.includes(stored.activeTab) ? stored.activeTab : defaults.activeTab,
      budget: {
        ...defaults.budget,
        ...(stored.budget && typeof stored.budget === "object" ? stored.budget : {}),
        items: Array.isArray(stored.budget?.items) ? stored.budget.items.slice(0, 500) : [],
      },
      investment: {
        ...defaults.investment,
        ...(stored.investment && typeof stored.investment === "object" ? stored.investment : {}),
      },
      loan: {
        ...defaults.loan,
        ...(stored.loan && typeof stored.loan === "object" ? stored.loan : {}),
      },
      loanScheduleView: stored.loanScheduleView === "payments" ? "payments" : "annual",
      tax: {
        ...defaults.tax,
        ...(stored.tax && typeof stored.tax === "object" ? stored.tax : {}),
      },
    };
  } catch {
    return defaults;
  }
}

function createDefaultState() {
  const startDate = formatLocalDate(new Date());
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return {
    activeTab: "budget",
    budget: { startDate, endDate: formatLocalDate(end), items: [] },
    investment: {
      principal: 10_000,
      monthlyContribution: 500,
      annualRate: 7,
      years: 20,
      compoundsPerYear: 12,
      contributionTiming: "end",
    },
    loan: {
      principal: 300_000,
      annualRate: 6.5,
      years: 30,
      paymentsPerYear: 12,
      extraPayment: 0,
    },
    loanScheduleView: "annual",
    tax: { query: "", jurisdiction: "federal", categoryId: "all" },
  };
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveStatus.textContent = "Saved locally";
  } catch {
    saveStatus.textContent = "Local saving unavailable";
  }
}

function fillForm(form, values) {
  Object.entries(values).forEach(([name, value]) => {
    const control = form.elements.namedItem(name);
    if (control) control.value = value;
  });
}

function readFormValues(form) {
  const values = Object.fromEntries(new FormData(form));
  [...form.elements].forEach((control) => {
    if (control instanceof HTMLInputElement && control.type === "number") {
      values[control.name] = Number(control.value);
    }
  });
  return values;
}

function scheduleFormRender(render) {
  clearTimeout(formRenderTimer);
  formRenderTimer = setTimeout(render, 100);
}

function createTableRow(values) {
  const row = document.createElement("tr");
  values.forEach((value) => row.append(createTextCell(value)));
  return row;
}

function createTextCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function sum(rows, key) {
  return Math.round(rows.reduce((total, row) => total + row[key], 0) * 100) / 100;
}

function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0);
}

function formatDuration(years) {
  if (years < 1) return `${Math.round(years * 12)} months`;
  const wholeYears = Math.floor(years);
  const months = Math.round((years - wholeYears) * 12);
  if (!months) return `${wholeYears} ${wholeYears === 1 ? "year" : "years"}`;
  return `${wholeYears}y ${months}m`;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function hideError(element) {
  element.textContent = "";
  element.hidden = true;
}

function getFinanceError(error) {
  return error instanceof FinanceInputError ? error.message : "The projection could not be calculated.";
}

installCurrentToolAiHost({
  id: "budget-finance",
  title: "Budget & Finance",
  description: "Runs deterministic budgeting, investment, loan, and tax-directory calculations.",
  limitations: [
    "Calculation commands do not alter saved financial data.",
    "Saved financial values require explicit sensitive-data permission.",
    "Results are educational calculations, not financial or tax advice.",
  ],
  getSnapshot: () => ({ state }),
  getContext: (_options, snapshot) => ({
    activeTab: snapshot.state.activeTab,
    budgetItemCount: snapshot.state.budget.items.length,
    hasInvestmentScenario: Boolean(snapshot.state.investment),
    hasLoanScenario: Boolean(snapshot.state.loan),
    taxDirectoryReviewed: TAX_DIRECTORY_REVIEWED_DATE,
  }),
  commands: [
    {
      type: "budget.calculate",
      description: "Project caller-supplied recurring income and expenses over a date range.",
      permissions: [],
      schema: {
        type: "object",
        required: ["items", "range"],
        properties: {
          items: { type: "array" },
          range: { type: "object" },
        },
        additionalProperties: false,
      },
      execute(_state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["items", "range"], commandIndex);
        if (!Array.isArray(command.items)) throw new Error("items must be a list.");
        const range = requireCommandRecord(command.range, "range", commandIndex);
        return { value: calculateBudgetProjection(command.items, range) };
      },
    },
    {
      type: "investment.calculate",
      description: "Calculate growth for caller-supplied investment assumptions.",
      permissions: [],
      execute(_state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["input"], commandIndex);
        const input = requireCommandRecord(command.input, "input", commandIndex);
        return { value: calculateInvestmentGrowth(input) };
      },
    },
    {
      type: "loan.calculate",
      description: "Calculate a fixed-rate amortization schedule from caller-supplied assumptions.",
      permissions: [],
      execute(_state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["input"], commandIndex);
        const input = requireCommandRecord(command.input, "input", commandIndex);
        return { value: calculateLoanAmortization(input) };
      },
    },
    {
      type: "tax.search",
      description: "Search the bundled official-government tax resource directory.",
      permissions: [],
      execute(_state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["filters"], commandIndex);
        const filters = command.filters === undefined
          ? {}
          : requireCommandRecord(command.filters, "filters", commandIndex);
        return {
          value: {
            reviewedDate: TAX_DIRECTORY_REVIEWED_DATE,
            irsStateDirectoryUrl: IRS_STATE_DIRECTORY_URL,
            records: searchTaxDirectory(taxDirectory, filters),
          },
        };
      },
    },
    {
      type: "state.get",
      description: "Read all locally saved budget and scenario inputs.",
      permissions: ["read-content", "sensitive-data"],
      execute(snapshot, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return { value: snapshot.state };
      },
    },
    {
      type: "budget.current-project",
      description: "Project the locally saved budget over its configured date range.",
      permissions: ["read-content", "sensitive-data"],
      execute(snapshot, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return {
          value: calculateBudgetProjection(
            snapshot.state.budget.items,
            snapshot.state.budget,
          ),
        };
      },
    },
  ],
});
