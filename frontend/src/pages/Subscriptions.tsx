import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Category, Me, Source, SubscriptionMonthlyTotal } from "@/types";
import { fmtCompactMoney, fmtMoney, todayISO } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";
import ConfirmDialog from "@/components/ConfirmDialog";
import { preferredCurrency, withCurrency } from "@/lib/preferences";

type Frequency = "monthly" | "yearly";
type CurrencyCode = "IDR" | "SGD" | "JPY" | "AUD" | "TWD";
const CURRENCIES: CurrencyCode[] = ["IDR", "SGD", "JPY", "AUD", "TWD"];
type Subscription = {
  id: number;
  name: string;
  amount: string;
  currency: string;
  source_id: number;
  source_name: string;
  category_id: number;
  category_name: string;
  billing_day: number;
  frequency: Frequency;
  active: boolean;
  start_date: string;
  end_date: string | null;
  next_billing_date: string;
  last_billed_at: string | null;
};
type Charge = {
  id: number;
  subscription_id: number;
  subscription_name: string;
  due_date: string;
  status: "pending" | "confirmed" | "skipped";
  transaction_id: number | null;
  notified_at: string | null;
  resolved_at: string | null;
};

function NewSubscriptionForm({ onDone }: { onDone: () => void }) {
  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const { data: srcs } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });
  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const userDefault = (me?.default_currency ?? "IDR") as CurrencyCode;

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>(userDefault);
  const [billingDay, setBillingDay] = useState(15);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [sourceId, setSourceId] = useState<number | "">("");
  const [startDate, setStartDate] = useState(todayISO());

  useEffect(() => {
    setCurrency(userDefault);
  }, [userDefault]);

  const create = useMutation({
    mutationFn: () =>
      api.post("/subscriptions", {
        name,
        amount,
        currency,
        source_id: Number(sourceId),
        category_id: Number(categoryId),
        billing_day: billingDay,
        frequency,
        start_date: startDate,
      }),
    onSuccess: onDone,
  });

  return (
    <form
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 sm:p-5 border border-paper-rule bg-paper-deep/30"
      onSubmit={(e) => {
        e.preventDefault();
        if (name && amount && categoryId && sourceId) create.mutate();
      }}
    >
      <label className="sm:col-span-2">
        <span className="smallcaps text-ink-mute block">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Wanikani, Claude, Netflix…"
          className="bg-transparent border-b border-ink py-1 w-full"
        />
      </label>
      <label>
        <span className="smallcaps text-ink-mute block">Amount</span>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="bg-transparent border-b border-ink py-1 w-full num"
        />
      </label>
      <label>
        <span className="smallcaps text-ink-mute block">Currency</span>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
          className="bg-transparent border-b border-ink py-1 w-full"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="smallcaps text-ink-mute block">Billing day</span>
        <input
          type="number"
          min={1}
          max={31}
          value={billingDay}
          onChange={(e) => setBillingDay(Number(e.target.value))}
          className="bg-transparent border-b border-ink py-1 w-full num"
        />
      </label>
      <label>
        <span className="smallcaps text-ink-mute block">Frequency</span>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          className="bg-transparent border-b border-ink py-1 w-full"
        >
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label>
        <span className="smallcaps text-ink-mute block">Source</span>
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : "")}
          className="bg-transparent border-b border-ink py-1 w-full"
        >
          <option value="">—</option>
          {srcs?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="smallcaps text-ink-mute block">Category</span>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
          className="bg-transparent border-b border-ink py-1 w-full"
        >
          <option value="">—</option>
          {cats?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="smallcaps text-ink-mute block">Start date</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="bg-transparent border-b border-ink py-1 w-full"
        />
      </label>
      <div className="sm:col-span-2 md:col-span-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
        <button type="button" onClick={onDone} className="smallcaps text-ink-mute">
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending}
          className="smallcaps px-4 py-2 bg-ink text-paper disabled:opacity-60"
        >
          {create.isPending ? "Saving…" : "Add subscription"}
        </button>
      </div>
    </form>
  );
}

export default function SubscriptionsPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Subscription | null>(null);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const isMobile = typeof window !== "undefined" ? window.innerWidth < 640 : false;

  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/auth/me"),
  });
  const userCurrency = preferredCurrency(me);

  const { data: subs } = useQuery<Subscription[]>({
    queryKey: ["subscriptions"],
    queryFn: () => api.get<Subscription[]>("/subscriptions"),
  });
  const { data: pending } = useQuery<Charge[]>({
    queryKey: ["subscriptions", "pending"],
    queryFn: () => api.get<Charge[]>("/subscriptions/charges/pending"),
    refetchInterval: 60_000,
  });
  const { data: monthlyTotalData } = useQuery<SubscriptionMonthlyTotal>({
    queryKey: ["subscriptions", "monthly-total", userCurrency],
    queryFn: () =>
      api.get<SubscriptionMonthlyTotal>(
        withCurrency("/subscriptions/monthly-total", userCurrency)
      ),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/subscriptions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      setPendingDelete(null);
    },
  });
  const confirmCharge = useMutation({
    mutationFn: (id: number) => api.post(`/subscriptions/charges/${id}/confirm`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
  const skip = useMutation({
    mutationFn: (id: number) => api.post(`/subscriptions/charges/${id}/skip`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subscriptions"] }),
  });

  const totalDisplayCurrency = monthlyTotalData?.currency ?? userCurrency;
  const totalDisplay = monthlyTotalData
    ? (isMobile
        ? fmtCompactMoney(monthlyTotalData.total, totalDisplayCurrency)
        : fmtMoney(monthlyTotalData.total, totalDisplayCurrency))
    : "—";

  return (
    <div className="space-y-10">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <SectionTitle kicker="Recurring charges">Subscriptions</SectionTitle>
        <div className="text-right">
          <p className="smallcaps text-ink-mute">Monthly total</p>
          <p className="num text-2xl">{totalDisplay}</p>
        </div>
      </div>

      {(pending ?? []).length > 0 && (
        <section>
          <p className="smallcaps text-accent">Awaiting your nod</p>
          <ul className="mt-3 divide-y divide-paper-rule border-t border-b border-paper-rule">
            {pending!.map((c) => (
              <li key={c.id} className="py-3 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-[500]">{c.subscription_name}</p>
                  <p className="text-ink-soft text-sm">Due {c.due_date}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => skip.mutate(c.id)}
                    className="smallcaps px-3 py-1 border border-ink-mute hover:border-accent hover:text-accent"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => confirmCharge.mutate(c.id)}
                    className="smallcaps px-3 py-1 bg-ink text-paper"
                  >
                    Confirm
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex justify-between items-end mb-2">
          <p className="smallcaps text-ink-mute">On the books</p>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="smallcaps px-3 py-1 bg-ink text-paper"
            >
              + New subscription
            </button>
          )}
        </div>

        {adding && (
          <div className="mb-6">
            <NewSubscriptionForm
              onDone={() => {
                setAdding(false);
                qc.invalidateQueries({ queryKey: ["subscriptions"] });
              }}
            />
          </div>
        )}

        <div className="-mx-2 px-2 sm:mx-0 sm:px-0">
          <table className="ledger-table w-full text-[11px] sm:text-[13px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Source</th>
                <th>Category</th>
                <th className="text-right">Amount</th>
                <th>Cadence</th>
                <th>Next</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(subs ?? []).map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-50"}>
                  <td className="font-[500]">{s.name}</td>
                  <td className="text-ink-soft">{s.source_name}</td>
                  <td>{s.category_name}</td>
                  <td className="text-right num text-accent">
                    {isMobile
                      ? fmtCompactMoney(s.amount, (s.currency as CurrencyCode) || "IDR")
                      : fmtMoney(s.amount, (s.currency as CurrencyCode) || "IDR")}
                  </td>
                  <td className="smallcaps text-ink-mute">{s.frequency}</td>
                  <td className="num text-ink-soft">{s.next_billing_date}</td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing(s)}
                      className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2 mr-1"
                    >
                      edit
                    </button>
                    <button
                      onClick={() => setPendingDelete(s)}
                      className="smallcaps text-ink-mute hover:text-accent inline-block p-2 -m-2"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {subs && subs.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-ink-mute py-8">
                    No subscriptions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "this subscription"}?`}
        message="This removes the recurring definition and future scheduled charges."
        confirmLabel="Delete"
        busy={del.isPending}
        onClose={() => {
          if (!del.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) del.mutate(pendingDelete.id);
        }}
      />
      {editing && (
        <EditSubscriptionModal
          subscription={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditSubscriptionModal({
  subscription,
  onClose,
}: {
  subscription: Subscription;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const { data: srcs } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });

  const [name, setName] = useState(subscription.name);
  const [amount, setAmount] = useState(String(subscription.amount));
  const [currency, setCurrency] = useState<CurrencyCode>(
    (subscription.currency as CurrencyCode) || "IDR"
  );
  const [billingDay, setBillingDay] = useState(subscription.billing_day);
  const [frequency, setFrequency] = useState<Frequency>(subscription.frequency);
  const [categoryId, setCategoryId] = useState(subscription.category_id);
  const [sourceId, setSourceId] = useState(subscription.source_id);
  const [active, setActive] = useState(subscription.active);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/subscriptions/${subscription.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      onClose();
    },
  });

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-card w-full max-w-lg p-6">
        <h3 className="font-semibold mb-4">Edit: {subscription.name}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="sm:col-span-2">
            <span className="smallcaps text-ink-mute block mb-1">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
            />
          </label>
          <label>
            <span className="smallcaps text-ink-mute block mb-1">Amount</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full num"
            />
          </label>
          <label>
            <span className="smallcaps text-ink-mute block mb-1">Currency</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="smallcaps text-ink-mute block mb-1">Billing day</span>
            <input
              type="number"
              min={1}
              max={31}
              value={billingDay}
              onChange={(e) => setBillingDay(Number(e.target.value))}
              className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full num"
            />
          </label>
          <label>
            <span className="smallcaps text-ink-mute block mb-1">Frequency</span>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label>
            <span className="smallcaps text-ink-mute block mb-1">Source</span>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(Number(e.target.value))}
              className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
            >
              {srcs?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="smallcaps text-ink-mute block mb-1">Category</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              className="bg-transparent border border-ink/30 rounded px-2 py-1 w-full"
            >
              {cats?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span className="smallcaps text-ink-mute">Active</span>
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => {
              const body: Record<string, unknown> = {};
              if (name !== subscription.name) body.name = name;
              if (amount !== String(subscription.amount)) body.amount = amount;
              if (currency !== subscription.currency) body.currency = currency;
              if (billingDay !== subscription.billing_day) body.billing_day = billingDay;
              if (frequency !== subscription.frequency) body.frequency = frequency;
              if (sourceId !== subscription.source_id) body.source_id = sourceId;
              if (categoryId !== subscription.category_id) body.category_id = categoryId;
              if (active !== subscription.active) body.active = active;
              if (Object.keys(body).length === 0) {
                onClose();
                return;
              }
              patch.mutate(body);
            }}
            disabled={patch.isPending}
            className="smallcaps px-3 py-1 bg-ink text-paper rounded disabled:opacity-60"
          >
            {patch.isPending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="smallcaps px-3 py-1 border border-ink/30 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
