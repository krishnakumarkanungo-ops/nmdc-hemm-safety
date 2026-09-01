FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Expose default cloud ports
EXPOSE 8000
EXPOSE 10000

# Execute main.py which automatically binds to Render's dynamic $PORT
CMD ["python", "main.py"]
