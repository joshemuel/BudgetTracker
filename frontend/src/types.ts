export type Me = {
  id: number;
  username: string;
  default_currency: "IDR" | "SGD" | "JPY" | "AUD" | "TWD";
  default_expense_source_id: number | null;
};

export type Source = {
  id: number;
  name: string;
  starting_balance: string;
  currency: "IDR" | "SGD" | "JPY" | "AUD" | "TWD";
  is_credit_card: boolean;
  active: boolean;
  current_balance: string;
};

export type Category = {
  id: number;
  name: string;
  is_default: boolean;
};

export type Budget = {
  id: number;
  category_id: number;
  category_name: string;
  monthly_limit: string;
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
  description: string | null;
  transfer_group_id: string | null;
  subscription_charge_id: number | null;
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
  days_in_month: number;
  today_day: number;
  totals: { income: string; expense: string; net: string };
  budgets: OverviewBudget[];
  credit: { outstanding: string; month_charges: string; month_payments: string };
};

export type MonthlyRow = { month: number; income: string; expense: string; net: string };
export type Monthly = { year: number; months: MonthlyRow[] };

export type DailyRow = { day: number; income: string; expense: string };
export type Daily = { year: number; month: number; days: DailyRow[] };

export type CategoryStat = {
  category_id: number;
  category_name: string;
  income: string;
  expense: string;
  transactions: number;
};
export type CategoryStats = { from: string; to: string; categories: CategoryStat[] };
