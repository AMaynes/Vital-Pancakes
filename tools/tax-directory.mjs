/**
 * Searchable official-source tax reference directory.
 *
 * State entries point to the IRS state-government pages, which in turn link to
 * current state tax, employer, business, and filing authorities. The directory
 * intentionally stores categories and sources rather than frozen tax rates.
 */

export const TAX_DIRECTORY_REVIEWED_DATE = "2026-07-29";
export const IRS_STATE_DIRECTORY_URL = "https://www.irs.gov/businesses/small-businesses-self-employed/state-government-websites";

export const STATE_JURISDICTIONS = Object.freeze([
  ["AL", "Alabama", "alabama"],
  ["AK", "Alaska", "alaska"],
  ["AZ", "Arizona", "arizona"],
  ["AR", "Arkansas", "arkansas"],
  ["CA", "California", "california"],
  ["CO", "Colorado", "colorado"],
  ["CT", "Connecticut", "connecticut"],
  ["DE", "Delaware", "delaware"],
  ["DC", "District of Columbia", "district-of-columbia"],
  ["FL", "Florida", "florida"],
  ["GA", "Georgia", "georgia"],
  ["HI", "Hawaii", "hawaii"],
  ["ID", "Idaho", "idaho"],
  ["IL", "Illinois", "illinois"],
  ["IN", "Indiana", "indiana"],
  ["IA", "Iowa", "iowa"],
  ["KS", "Kansas", "kansas"],
  ["KY", "Kentucky", "kentucky"],
  ["LA", "Louisiana", "louisiana"],
  ["ME", "Maine", "maine"],
  ["MD", "Maryland", "maryland"],
  ["MA", "Massachusetts", "massachusetts"],
  ["MI", "Michigan", "michigan"],
  ["MN", "Minnesota", "minnesota"],
  ["MS", "Mississippi", "mississippi"],
  ["MO", "Missouri", "missouri"],
  ["MT", "Montana", "montana"],
  ["NE", "Nebraska", "nebraska"],
  ["NV", "Nevada", "nevada"],
  ["NH", "New Hampshire", "new-hampshire"],
  ["NJ", "New Jersey", "new-jersey"],
  ["NM", "New Mexico", "new-mexico"],
  ["NY", "New York", "new-york"],
  ["NC", "North Carolina", "north-carolina"],
  ["ND", "North Dakota", "north-dakota"],
  ["OH", "Ohio", "ohio"],
  ["OK", "Oklahoma", "oklahoma"],
  ["OR", "Oregon", "oregon"],
  ["PA", "Pennsylvania", "pennsylvania"],
  ["RI", "Rhode Island", "rhode-island"],
  ["SC", "South Carolina", "south-carolina"],
  ["SD", "South Dakota", "south-dakota"],
  ["TN", "Tennessee", "tennessee"],
  ["TX", "Texas", "texas"],
  ["UT", "Utah", "utah"],
  ["VT", "Vermont", "vermont"],
  ["VA", "Virginia", "virginia"],
  ["WA", "Washington", "washington"],
  ["WV", "West Virginia", "west-virginia"],
  ["WI", "Wisconsin", "wisconsin"],
  ["WY", "Wyoming", "wyoming"],
].map(([code, name, slug]) => Object.freeze({ code, name, slug })));

export const STATE_TAX_CATEGORIES = Object.freeze([
  category("individual-income", "Individual income", "personal income return resident nonresident withholding refund"),
  category("business-income", "Business, corporate & franchise", "corporation partnership pass-through franchise gross receipts commerce business privilege"),
  category("sales-use", "Sales, use & gross receipts", "sales use transaction privilege general excise retail seller marketplace nexus"),
  category("payroll-employment", "Payroll, withholding & employment", "employer wage withholding payroll registration worker"),
  category("unemployment", "Unemployment insurance", "SUTA unemployment insurance employer contribution workforce"),
  category("property", "Property & real estate", "property real estate parcel assessment transfer recording local county municipal"),
  category("estate-inheritance-gift", "Estate, inheritance & gift", "estate inheritance gift fiduciary trust probate"),
  category("excise", "Excise & special industry", "excise alcohol tobacco cannabis gaming gambling insurance utility communications environmental"),
  category("fuel-vehicle", "Fuel, vehicle & transportation", "motor fuel gasoline diesel vehicle registration highway trucking aviation rental car"),
  category("lodging-local", "Lodging & local taxes", "hotel occupancy lodging meals tourism local city county municipal"),
  category("estimated-tax", "Estimated tax", "quarterly estimated payment voucher individual business"),
  category("credits-deductions", "Credits, deductions & exemptions", "credit deduction exemption rebate incentive abatement"),
  category("retirement-investment", "Retirement & investment income", "capital gains dividends interest pension retirement social security"),
  category("forms-payments", "Forms, filing, payments & refunds", "forms instructions filing due date portal account payment refund extension amended return"),
  category("other-special", "Other and special taxes", "severance mineral insurance premium utility communications environmental occupational license miscellaneous"),
]);

const FEDERAL_RESOURCES = Object.freeze([
  federal("individual-income", "Individual income tax", "Form 1040 filing, income, withholding, payments, refunds, and life-event guidance.", "https://www.irs.gov/individual-tax-filing", "1040 personal income filing withholding refund"),
  federal("business-income", "Business income taxes", "Income, estimated, self-employment, employment, and excise tax starting points for businesses.", "https://www.irs.gov/businesses/business-taxes", "corporate corporation partnership business"),
  federal("payroll-employment", "Employment and payroll taxes", "Federal withholding, Social Security, Medicare, FUTA, and employer filing resources.", "https://www.irs.gov/businesses/small-businesses-self-employed/employment-taxes", "payroll withholding FICA FUTA employer"),
  federal("unemployment", "Federal unemployment tax", "FUTA obligations and federal employer tax filing information.", "https://www.irs.gov/businesses/small-businesses-self-employed/federal-unemployment-tax", "FUTA unemployment employer"),
  federal("estimated-tax", "Estimated taxes", "Pay-as-you-go estimated tax requirements and payment guidance.", "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes", "quarterly estimated payment voucher"),
  federal("estate-inheritance-gift", "Estate and gift taxes", "Federal estate, gift, executor, and related return guidance.", "https://www.irs.gov/businesses/small-businesses-self-employed/estate-and-gift-taxes", "estate gift inheritance executor trust"),
  federal("excise", "Federal excise taxes", "Federal excise programs, forms, filing, and payment resources.", "https://www.irs.gov/businesses/small-businesses-self-employed/excise-tax", "fuel communications transportation environmental wagering excise"),
  federal("retirement-investment", "Investment income and capital gains", "Federal capital gain and loss rules and reporting starting points.", "https://www.irs.gov/taxtopics/tc409", "capital gain loss investment stock asset"),
  federal("property", "Real estate taxes and deductions", "Federal guidance on deductible real estate taxes and related limits.", "https://www.irs.gov/taxtopics/tc503", "property real estate deduction home"),
  federal("credits-deductions", "Credits and deductions", "Current federal individual and business credit and deduction resources.", "https://www.irs.gov/credits-and-deductions", "credit deduction exemption rebate"),
  federal("forms-payments", "Forms and instructions", "Search current IRS forms, schedules, publications, and instructions.", "https://www.irs.gov/forms-instructions", "forms instructions schedules publications"),
  federal("forms-payments", "Payments and account options", "Official federal tax payment, account, and payment-plan options.", "https://www.irs.gov/payments", "pay payment plan account direct pay EFTPS"),
  federal("other-special", "Industry and profession tax centers", "Specialized federal tax centers for industries, professions, and business situations.", "https://www.irs.gov/businesses/small-businesses-self-employed/industries-professions-and-business-tax-centers", "industry profession special tax center"),
]);

export function createTaxDirectory() {
  const federal = FEDERAL_RESOURCES.map((resource, index) => ({
    ...resource,
    id: `federal-${index}-${resource.categoryId}`,
    jurisdictionId: "federal",
    jurisdictionName: "Federal",
    jurisdictionCode: "US",
    sourceLabel: "Internal Revenue Service",
  }));

  const states = STATE_JURISDICTIONS.flatMap((jurisdiction) => {
    const sourceUrl = `https://www.irs.gov/businesses/small-businesses-self-employed/${jurisdiction.slug}`;
    return STATE_TAX_CATEGORIES.map((taxCategory) => ({
      id: `${jurisdiction.code.toLowerCase()}-${taxCategory.id}`,
      jurisdictionId: jurisdiction.code.toLowerCase(),
      jurisdictionName: jurisdiction.name,
      jurisdictionCode: jurisdiction.code,
      categoryId: taxCategory.id,
      categoryName: taxCategory.name,
      title: taxCategory.name,
      description: `${jurisdiction.name} official-government starting points for ${taxCategory.name.toLowerCase()}.`,
      keywords: `${jurisdiction.name} ${jurisdiction.code} ${taxCategory.keywords}`,
      sourceUrl,
      sourceLabel: "IRS state government links",
    }));
  });

  return [...federal, ...states];
}

export function searchTaxDirectory(records, filters = {}) {
  const queryTerms = normalizeSearch(filters.query).split(" ").filter(Boolean);
  const jurisdiction = normalizeSearch(filters.jurisdiction);
  const categoryId = normalizeSearch(filters.categoryId);
  const limit = Number.isInteger(filters.limit) && filters.limit > 0
    ? Math.min(filters.limit, 500)
    : 100;

  return records
    .filter((record) => !jurisdiction || jurisdiction === "all" || record.jurisdictionId === jurisdiction)
    .filter((record) => !categoryId || categoryId === "all" || record.categoryId === categoryId)
    .filter((record) => {
      if (!queryTerms.length) return true;
      const haystack = normalizeSearch([
        record.jurisdictionName,
        record.jurisdictionCode,
        record.categoryName,
        record.title,
        record.description,
        record.keywords,
      ].join(" "));
      return queryTerms.every((term) => haystack.includes(term));
    })
    .slice(0, limit);
}

function category(id, name, keywords) {
  return Object.freeze({ id, name, keywords });
}

function federal(categoryId, title, description, sourceUrl, keywords) {
  const categoryName = STATE_TAX_CATEGORIES.find((item) => item.id === categoryId)?.name ?? title;
  return Object.freeze({
    categoryId,
    categoryName,
    title,
    description,
    sourceUrl,
    keywords,
  });
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
