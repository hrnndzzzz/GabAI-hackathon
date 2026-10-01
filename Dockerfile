FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /service
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock \
    && useradd --create-home --uid 10001 teachease
COPY app ./app
USER teachease
EXPOSE 8080
# TLS terminates at Cloud Run. Avoid access logs containing student/assessment IDs in paths.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --no-access-log --no-proxy-headers"]
