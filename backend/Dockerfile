FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libpq-dev curl ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/
RUN pip install --upgrade pip && pip install -e .

COPY . /app

# Run as a non-root user. Deps are installed system-wide (world-readable) and
# the app writes nothing to disk, so no chown is needed.
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# Production-safe default (no --reload). Dev opts into reload via the compose
# `command:` override, which also bind-mounts the source for hot reload.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
