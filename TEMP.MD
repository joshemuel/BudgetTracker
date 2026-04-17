# BudgetTracker Shipping Notes (Temp Handoff)

Date: 2026-04-17

Commit shipped: `f7a13e9`

## What changed

### 1) Layout proportions (PC vs laptop scaling)
- Reduced global shell width and tightened spacing in `frontend/src/layout/AppShell.tsx`.
- Reduced oversized heading scaling (masthead + section display text):
  - `frontend/src/layout/AppShell.tsx`
  - `frontend/src/components/Figure.tsx`
  - `frontend/src/pages/Overview.tsx`
- Added medium-screen proportional tuning (768-1366px) in `frontend/src/styles.css`.

### 2) Default currency now drives Overview/Monthly/Daily views
- Backend stats endpoints now support reporting currency and default to user preference:
  - `/stats/overview`
  - `/stats/monthly`
  - `/stats/daily`
- Implemented conversion/rounding path in `backend/app/api/stats.py` (uses user `default_currency` when `currency` query is not set).
- Frontend now requests stats with selected/default currency and formats with returned `currency`:
  - `frontend/src/pages/Overview.tsx`
  - `frontend/src/pages/Monthly.tsx`
  - `frontend/src/pages/Daily.tsx`
  - helper: `frontend/src/lib/preferences.ts`
  - types updated: `frontend/src/types.ts`
- Preferences save now invalidates affected queries:
  - `frontend/src/components/UserPrefsMenu.tsx`

### 3) Delete confirmation popups unified
- Added reusable confirmation modal: `frontend/src/components/ConfirmDialog.tsx`.
- Replaced native `confirm(...)` dialogs in:
  - `frontend/src/pages/Settings.tsx`
  - `frontend/src/pages/Transactions.tsx`
  - `frontend/src/pages/Subscriptions.tsx`

### 4) Source amount reset behavior + editable entries
- Source reset transaction no longer uses description `"Starting Budget"`; description is now `null`.
- Reconciliation category moved to `Untrackable` (with fallback support for legacy `Untracked`) in `backend/app/api/sources.py`.
- Added transaction Edit modal/workflow in `frontend/src/pages/Transactions.tsx` so entries can be manually adjusted.

### 5) Category naming migration (`Untracked` -> `Untrackable`)
- Default category changed in `backend/app/db/models.py`.
- Seed/import compatibility updated in `backend/app/seed/import_xlsx.py`.
- Existing migration text updated: `backend/migrations/versions/8e8ebf9e5a1c_add_user_defaults_and_untracked.py`.
- New migration added to rename existing records safely:
  - `backend/migrations/versions/b5a18e5f2a31_rename_untracked_to_untrackable.py`

### 6) Build/test and hygiene improvements
- Frontend build script changed to avoid TS emitting JS into `src`:
  - `frontend/package.json`: `tsc --noEmit && vite build`
- Added `noEmit` in `frontend/tsconfig.json`.
- `.gitignore` extended for local/generated/root-owned artifact noise.

## Tests and validation run

### Backend
- `pytest -p no:cacheprovider` -> `20 passed`.
- Added tests:
  - `backend/tests/test_stats_currency.py`
  - `backend/tests/test_untrackable.py`

### Frontend
- `npm run build -- --outDir dist-local --emptyOutDir true` -> success.

## Deployment steps used

1. Commit and push to GitHub:
   - `git add -A`
   - `git commit -m "Ship proportional layout, currency-aware stats, and unified entry editing"`
   - `git push`

2. One-command deploy script:
   - `./deploy.sh "Ship proportional layout, currency defaults, and unified dialogs"`

3. Remote deploy actions performed by script (`/opt/budgettracker` on EC2):
   - `git pull`
   - `cd frontend && npm install --no-audit --no-fund && npm run build`
   - `sudo rsync -av --delete dist/ /var/www/budgettracker/`
   - `sudo docker compose -f docker-compose.prod.yml up -d --build db backend`
   - `sudo docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head`
   - `sudo nginx -t && sudo systemctl reload nginx`

4. Post-deploy checks performed:
   - Remote HEAD is `f7a13e9`
   - `docker compose ps` shows backend/db healthy
   - `curl http://127.0.0.1:8000/healthz` -> `{"status":"ok","db":true}`

## Notes for Claude follow-up

- If needed, run visual QA on real laptop + phone for final typography/table density.
- Confirm production hostname/DNS check path if external URL validation is required from this environment.
- Optional performance follow-up: frontend bundle still shows >500kB chunk warning from Vite.
