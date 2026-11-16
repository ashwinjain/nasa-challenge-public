.PHONY: setup setup-backend setup-frontend dev dev-backend dev-frontend precompute precompute-landing precompute-sun test check-bucket clean deploy deploy-api deploy-web

# One-shot setup: creates venv, installs deps, downloads ephemeris, installs frontend
setup: setup-backend setup-frontend
	@echo ""
	@echo "✓ Setup complete. Run 'make dev' to start the app."

setup-backend:
	python3 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -e ".[dev,maps]"
	.venv/bin/python scripts/download_ephemeris.py

setup-frontend:
	cd frontend && npm install

# Run both backend and frontend dev servers
dev:
	@echo "Starting backend on :8000 and frontend on :5173..."
	@make dev-backend & make dev-frontend

dev-backend:
	.venv/bin/uvicorn lunarsky.api:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

# Precompute all curated sites to frontend/public/data/ (default month)
precompute:
	.venv/bin/python scripts/precompute_static.py

# Phase 6: landing targets + panel spots for the 9 Artemis regions (~30 min).
# Reuses saved panel searches; add ARGS=--fresh to redo them. ARGS=--export-only
# just rewrites frontend/public/data/landing.json; ARGS=--terrain also bakes
# 3D terrain for each region's #1 target.
precompute-landing:
	.venv/bin/python scripts/precompute_landing.py $(ARGS)

# Hourly Sun at each region's #1 target panel spot, for sizing power in the page (after precompute-landing)
precompute-sun:
	.venv/bin/python scripts/precompute_sun.py

test:
	.venv/bin/pytest tests/ -v

# Read a few tiles of the big maps from the Firebase Storage bucket and
# compare them with data/ (needs a gcloud login; see docs/firebase-data.md)
check-bucket:
	.venv/bin/python scripts/check_bucket_read.py phase-2/LDEM_80S_80MPP_ADJ.TIF phase-2/LDEM_60S_240MPP_ADJ.TIF

clean:
	rm -rf .venv frontend/node_modules frontend/dist __pycache__

# Deploy (see docs/deploy.md). Backend first, so the /api rewrite has a target.
deploy: deploy-api deploy-web

deploy-api:
	gcloud run deploy lunar-navigator-api --source . --region us-central1 --project nasa-challenge-a8b4a --allow-unauthenticated --memory 2Gi

deploy-web:
	npx firebase-tools deploy --only hosting --project nasa-challenge-a8b4a
