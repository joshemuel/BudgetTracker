from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import get_settings
from app.services import daily_summary
from app.services import fx
from app.services import subscriptions as sub_svc
from app.services import weekly_report

log = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    s = get_settings()
    _scheduler = BackgroundScheduler(timezone=s.tz)
    _scheduler.add_job(
        sub_svc.run_daily,
        trigger=CronTrigger(hour=7, minute=0),
        id="subscriptions_daily",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        weekly_report.send_weekly_reports,
        trigger=CronTrigger(day_of_week="sun", hour=18, minute=0),
        id="weekly_reports",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        fx.refresh_rates,
        trigger=CronTrigger(hour=6, minute=30),
        id="fx_refresh",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        daily_summary.refresh_all,
        trigger=CronTrigger(hour=6, minute=45),
        id="daily_summary",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    log.info("scheduler started (tz=%s)", s.tz)


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
