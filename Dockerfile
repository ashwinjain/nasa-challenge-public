# Backend API for Cloud Run. Firebase Hosting serves the frontend and
# forwards /api/** here (see firebase.json).
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
COPY lunarsky/ lunarsky/
# The maps extra (rasterio, google-auth) lets lunarsky/data.py read the big
# maps straight from the Firebase Storage bucket, a few tiles at a time.
# rasterio's wheel bundles GDAL but links the system libexpat, which the slim
# image leaves out. The import check fails the build if a library is missing,
# instead of the first map request failing on Cloud Run.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libexpat1 \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir ".[maps]" \
 && python -c "import rasterio, google.auth; print('rasterio', rasterio.__version__, 'GDAL', rasterio.__gdal_version__)"

# Small files that nearly every request needs ship inside the image: the
# Phase 1 kernels (~19 MB, in git), the Phase 3 site list and the Phase 4
# power and lander assumptions, read from
# LUNAR_DATA_DIR. The big maps are not copied in; with no local copy,
# lunarsky/data.py reads them from the bucket as the service's own account.
COPY data/phase-1/de421.bsp data/phase-1/moon_pa_de421_1900-2050.bpc data/phase-1/moon_080317.tf data/phase-1/pck00008.tpc data/phase-1/
COPY data/phase-3/sites.csv data/phase-3/
COPY data/phase-4/assumptions.csv data/phase-4/
ENV LUNAR_DATA_DIR=/app/data

ENV PORT=8080
CMD exec uvicorn lunarsky.api:app --host 0.0.0.0 --port $PORT
