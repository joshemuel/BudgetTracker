# BudgetTracker Local Update (Testing Build)

This file summarizes all work currently present in the local workspace for your review before deployment.

## Scope of this change batch

Requested improvements:

1. Add privacy masking toggle (eye icon) so financial figures can be hidden/showed.
2. Fix Telegram default source mismatch with web-selected default expense source.
3. Rework finance chat into a docked bottom panel (not modal popup) similar to messenger-style behavior.
4. Fix transfer categorization so transfers are no longer consistently logged as Untrackable; map to Top-up or Investment.
5. Move Budgets management into its own top-level tab/page instead of Settings.
6. Investigate/fix flaky first click on Next pagination in Transactions.

## What was implemented

### 1) Privacy eye toggle + masked amounts

Implemented a reusable amount visibility preference with local persistence and cross-component sync:

- Added shared hook: `frontend/src/lib/privacy.ts`
  - stores visibility flag in `localStorage` (`bt_show_amounts`)
  - exposes `useAmountVisibility()` with `showAmounts` + `toggleAmounts`

Added eye toggle UI in header and page-level controls:

- `frontend/src/layout/AppShell.tsx`
  - new eye button next to preferences / quick log controls
- `frontend/src/pages/Overview.tsx`
  - added local eye control in page header
  - masks all overview amount surfaces when hidden (totals, budgets, credit, account balances)
- `frontend/src/pages/Budgets.tsx`
  - added local eye control and masked budget amount rendering
- `frontend/src/pages/Monthly.tsx`
  - masked YTD/table values and chart tooltip values
- `frontend/src/pages/Categories.tsx`
  - masked table amounts and pie tooltip values

Behavior:

- Hidden state displays `••••••` instead of values.
- Toggle state is shared and persists across refresh.

### 2) Telegram default source honoring web preferences

Problem observed:

- LLM/source extraction could still route entries to another source despite web default preference.

Fix approach:

- In `backend/app/api/telegram.py`, before logging items, resolve and apply `user.default_expense_source_id` as fallback/override for expense items where source is missing or not clearly matched from message context.
- Same fallback applied for media log extraction path.

Added safeguards:

- Do not override obvious credit-card source mentions for credit-card contexts.
- Keep income behavior unchanged.

### 3) Finance chat UX changed to docked panel (non-modal)

Updated web chat component to behave like a bottom docked tab/panel:

- `frontend/src/components/WebChat.tsx`
  - persistent bottom-right docked container (no full-screen overlay)
  - header/tab row with lion emoji and open/minimize behavior
  - expanded panel keeps page interactive (users can still interact with rest of app)
  - session-only behavior preserved: minimizing/closing resets chat state as currently implemented
  - text + audio recording flows retained

Integration:

- `frontend/src/layout/AppShell.tsx` still mounts `WebChat` globally.

### 4) Transfer categorization improvements

#### Logging path (`financial.log_items`)

- File: `backend/app/services/financial.py`
- Added transfer category resolver:
  - maps transfer items to `Top-up` by default
  - maps savings/investment-like destination/source labels to `Investment`
  - detects transfer by `is_internal` or `Transfer to ...` / `Transfer from ...` description
- Auto-creates missing transfer category (`Top-up` or `Investment`) for the user if absent.

#### Manual transfer endpoint (`/transactions/transfer`)

- File: `backend/app/api/transactions.py`
- `_transfer_category(...)` now chooses:
  - `Investment` when target source name looks savings/investment-like
  - otherwise `Top-up`
- Creates preferred category if missing.

Result:

- Transfer entries should no longer default to Untrackable in normal cases.

### 5) Budgets moved to own tab/page

Routing/nav changes:

- `frontend/src/App.tsx`
  - new route: `/budgets`
- `frontend/src/layout/AppShell.tsx`
  - added `Budgets` item to top nav

New page:

- `frontend/src/pages/Budgets.tsx`
  - moved budget CRUD UI out of settings
  - includes masking support via privacy toggle hook

Settings cleanup:

- `frontend/src/pages/Settings.tsx`
  - removed old embedded `BudgetsBlock`
  - now focuses on Sources + Categories only

### 6) Transactions Next button first-click issue

Likely cause investigated:

- query transitions with stale/empty intermediate data can trigger page normalization effect and produce a “jump to top / no page advance” feel.

Fixes applied in `frontend/src/pages/Transactions.tsx`:

- Added `placeholderData: keepPreviousData` in transaction list query.
- Prevented page clamping effect from running until `data` is present.
- Added `e.preventDefault()` in Prev/Next click handlers for stability.

## Backend tests added/updated

New tests:

- `backend/tests/test_default_source_preference.py`
  - verifies Telegram logging uses web default expense source
  - verifies unmentioned/weakly-matched LLM source is overridden by default source
- `backend/tests/test_transfer_category_mapping.py`
  - verifies regular wallet transfer maps to `Top-up`
  - verifies savings-like transfer maps to `Investment`

Updated test:

- `backend/tests/test_transfer_category_and_source_prompt.py`
  - transfer endpoint expectation updated to `Top-up`

## Local validation results

### Backend

Command:

- `.venv/bin/pytest`

Result:

- `50 passed, 1 warning`

### Frontend

Command:

- `npm run build -- --outDir dist-local`

Result:

- Build succeeded.

## Files changed in this local batch

Backend:

- `backend/app/api/telegram.py`
- `backend/app/api/transactions.py`
- `backend/app/services/financial.py`
- `backend/tests/test_transfer_category_and_source_prompt.py`
- `backend/tests/test_default_source_preference.py` (new)
- `backend/tests/test_transfer_category_mapping.py` (new)

Frontend:

- `frontend/src/App.tsx`
- `frontend/src/layout/AppShell.tsx`
- `frontend/src/components/WebChat.tsx`
- `frontend/src/pages/Overview.tsx`
- `frontend/src/pages/Monthly.tsx`
- `frontend/src/pages/Categories.tsx`
- `frontend/src/pages/Transactions.tsx`
- `frontend/src/pages/Settings.tsx`
- `frontend/src/pages/Budgets.tsx` (new)
- `frontend/src/lib/privacy.ts` (new)

Docs:

- `UPDATE.md` (this file)

## Notes

- No deployment was performed in this batch.
- Changes are ready for your local UX verification first.
