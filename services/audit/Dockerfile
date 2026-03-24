# services/auth/Dockerfile

FROM python:3.11-slim AS base

WORKDIR /app
ENV PYTHONPATH=/app

# Copy requirements first to install dependencies
COPY services/audit/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Dev target
FROM base AS dev
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9000", "--reload"]


# Prod target
FROM base AS prod
# Copy shared logic and service code
COPY ./services/audit /app
COPY ./services/auth/data /app/data

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9000"]
