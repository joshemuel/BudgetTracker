import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { Budget, Category, Source } from "@/types";
import { fmtIDR } from "@/lib/format";
import { SectionTitle } from "@/components/Figure";

function SourcesBlock() {
  const qc = useQueryClient();
  const { data } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => api.get<Source[]>("/sources"),
  });
  const [name, setName] = useState("");
  const [isCc, setIsCc] = useState(false);
  const [starting, setStarting] = useState("0");

  const create = useMutation({
    mutationFn: () =>
      api.post("/sources", {
        name,
        is_credit_card: isCc,
        starting_balance: starting || "0",
      }),
    onSuccess: () => {
      setName("");
      setStarting("0");
      setIsCc(false);
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/sources/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });

  return (
    <section>
      <SectionTitle kicker="The wallets">Sources</SectionTitle>
      <table className="ledger-table mb-4">
        <thead>
          <tr>
            <th>Name</th>
            <th className="text-right">Starting</th>
            <th className="text-right">Current</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.map((s) => (
            <tr key={s.id}>
              <td className="font-[450]">
                {s.name}
                {s.is_credit_card && (
                  <span className="ml-2 smallcaps text-accent">credit</span>
                )}
              </td>
              <td className="text-right num text-ink-mute">
                {fmtIDR(s.starting_balance)}
              </td>
              <td className="text-right num">{fmtIDR(s.current_balance)}</td>
              <td className="text-right">
                <button
                  onClick={() => {
                    if (confirm(`Delete ${s.name}?`)) del.mutate(s.id);
                  }}
                  className="smallcaps text-ink-mute hover:text-accent"
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border-b border-ink py-1"
          />
        </label>
        <label>
          <span className="smallcaps text-ink-mute block">Starting</span>
          <input
            type="number"
            value={starting}
            onChange={(e) => setStarting(e.target.value)}
            className="bg-transparent border-b border-ink py-1 w-32 num"
          />
        </label>
        <label className="flex items-center gap-2 py-1">
          <input type="checkbox" checked={isCc} onChange={(e) => setIsCc(e.target.checked)} />
          <span className="smallcaps text-ink-mute">Credit card</span>
        </label>
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper">
          Add source
        </button>
      </form>
    </section>
  );
}

function CategoriesBlock() {
  const qc = useQueryClient();
  const { data } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.post("/categories", { name }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  return (
    <section className="mt-12">
      <SectionTitle kicker="The taxonomy">Categories</SectionTitle>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 mb-6">
        {data?.map((c) => (
          <li key={c.id} className="flex items-center gap-1">
            <span className="font-[450]">{c.name}</span>
            {c.is_default && <span className="smallcaps text-ink-mute">default</span>}
          </li>
        ))}
      </ul>
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block">Custom category</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border-b border-ink py-1"
          />
        </label>
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper">
          Add
        </button>
      </form>
    </section>
  );
}

function BudgetsBlock() {
  const qc = useQueryClient();
  const { data: budgets } = useQuery<Budget[]>({
    queryKey: ["budgets"],
    queryFn: () => api.get<Budget[]>("/budgets"),
  });
  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [limit, setLimit] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.post("/budgets", {
        category_id: Number(categoryId),
        monthly_limit: limit,
      }),
    onSuccess: () => {
      setCategoryId("");
      setLimit("");
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/budgets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <section className="mt-12">
      <SectionTitle kicker="The fences">Budgets</SectionTitle>
      <table className="ledger-table mb-4">
        <thead>
          <tr>
            <th>Category</th>
            <th className="text-right">Monthly Limit</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {budgets?.map((b) => (
            <tr key={b.id}>
              <td className="font-[450]">{b.category_name}</td>
              <td className="text-right num">{fmtIDR(b.monthly_limit)}</td>
              <td className="text-right">
                <button
                  onClick={() => del.mutate(b.id)}
                  className="smallcaps text-ink-mute hover:text-accent"
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (categoryId && limit) save.mutate();
        }}
      >
        <label>
          <span className="smallcaps text-ink-mute block">Category</span>
          <select
            value={categoryId}
            onChange={(e) =>
              setCategoryId(e.target.value ? Number(e.target.value) : "")
            }
            className="bg-transparent border-b border-ink py-1"
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
          <span className="smallcaps text-ink-mute block">Monthly limit</span>
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="bg-transparent border-b border-ink py-1 w-40 num"
          />
        </label>
        <button type="submit" className="smallcaps px-3 py-1 bg-ink text-paper">
          Save
        </button>
      </form>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-3xl">
      <SourcesBlock />
      <CategoriesBlock />
      <BudgetsBlock />
    </div>
  );
}
