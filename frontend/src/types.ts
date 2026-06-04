export type CurrencyCode = "IDR" | "SGD" | "JPY" | "AUD" | "TWD";

export type Me = {
  id: number;
  username: string;
  email: string | null;
  is_admin: boolean;
  status: "pending" | "approved" | "rejected";
  default_currency: CurrencyCode;
  default_expense_source_id: number | null;
  sources_enabled: boolean;
};

export type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  is_admin: boolean;
  status: "pending" | "approved" | "rejected";
};

export type Source = {
  id: number;
  name: string;
  starting_balance: string;
  currency: CurrencyCode;
  is_credit_card: boolean;
  active: boolean;
  current_balance: string;
};

export type Category = {
  id: number;
  name: string;
  is_default: boolean;
};

export type CurrencyBalance = {
  currency: CurrencyCode;
  current_balance: string;
  default_source_id: number | null;
  default_source_name: string | null;
  source_count: number;
};

export type Budget = {
  id: number;
  category_id: number;
  category_name: string;
  monthly_limit: string;
  currency: CurrencyCode;
};

export type TxType = "expense" | "income";

export type Transaction = {
  id: number;
  occurred_at: string;
  type: TxType;
  category_id: number;
  category_name: string;
  amount: string;
  source_id: number;
  source_name: string;
  currency: CurrencyCode;
  description: string | null;
  transfer_group_id: string | null;
  subscription_charge_id: number | null;
  fx_rate: string | null;
};

export type TransactionList = {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
};

export type BudgetStatus = "ahead" | "on_track" | "behind" | "over";

export type OverviewBudget = {
  category_id: number;
  category_name: string;
  limit: string;
  spent: string;
  remaining: string;
  pct_used: number;
  status: BudgetStatus;
};

export type Overview = {
  year: number;
  month: number;
  currency: CurrencyCode;
  days_in_month: number;
  today_day: number;
  totals: { income: string; expense: string; net: string };
  budgets: OverviewBudget[];
  credit: { outstanding: string; month_charges: string; month_payments: string };
};

export type MonthlyRow = { month: number; income: string; expense: string; net: string };
export type Monthly = { year: number; currency: CurrencyCode; months: MonthlyRow[] };

export type DailyRow = { day: number; income: string; expense: string };
export type Daily = { year: number; month: number; currency: CurrencyCode; days: DailyRow[] };

export type Projection = {
  currency: CurrencyCode;
  avg_daily_expense: string;
  /** Per-day-of-month typical spend (index 0 = day 1), capped + averaged over recent months. */
  daily_profile: string[];
  months_used: number;
  days_total: number;
  days_excluded: number;
};

export type Summary = {
  text: string;
  generated_on: string;
};

export type CategoryStat = {
  category_id: number;
  category_name: string;
  income: string;
  expense: string;
  transactions: number;
};
export type CategoryStats = {
  from: string;
  to: string;
  currency: CurrencyCode;
  categories: CategoryStat[];
};

export type SubscriptionMonthlyTotal = {
  total: string;
  currency: CurrencyCode;
};
