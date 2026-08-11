# Celery worker — dormant infrastructure (specs/01-cleanup-scaffold.md §1.3).
#
# Rewritten from the pre-rebuild server/Dockerfile, which served uvicorn. There is no
# FastAPI application any more; this image exists only to run the worker.

FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY celery_app/ ./celery_app/

# Never run the worker as root — a compromised task would otherwise own the container.
RUN useradd --create-home --shell /usr/sbin/nologin worker \
    && chown -R worker:worker /app
USER worker

CMD ["celery", "-A", "celery_app.celery", "worker", "--loglevel=info"]
