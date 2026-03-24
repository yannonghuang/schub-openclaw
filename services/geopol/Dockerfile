# services/geopol/Dockerfile

FROM python:3.11-slim AS base

WORKDIR /app
ENV PYTHONPATH=/app

# Install system dependencies for Playwright + Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgobject-2.0-0 \
    libnspr4 \
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxshmfence1 \
    libx11-6 \
    libxext6 \
    libasound2 \
    libexpat1 \
    libatspi2.0-0 \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to install dependencies
COPY services/geopol/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (Chromium only to keep it smaller)
RUN playwright install --with-deps chromium

# Dev target
FROM base AS dev
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8500", "--reload"]


# Prod target
FROM base AS prod
# Copy shared logic and service code
COPY ./services/geopol /app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8500"]
