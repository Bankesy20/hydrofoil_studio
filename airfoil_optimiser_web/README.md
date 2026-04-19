# HydroOptFoil (web)

React + TypeScript + Vite frontend with a FastAPI backend that drives the existing optimiser in [`../airfoil_optimiser/hydrooptfoil`](../airfoil_optimiser/hydrooptfoil) (SciPy differential evolution + **NeuralFoil**). The Streamlit app in that package remains available for debugging.

## Prerequisites

- Node.js **20.19+** or **22.12+** (Vite 7 requirement)
- **Python 3** on `PATH` as `python3` (macOS/Linux) or adjust `scripts/ensure-venv.mjs` if you only have `python`)

## One command (recommended)

From the repo root (or anywhere), then:

```bash
cd airfoil_optimiser_web && npm start
```

The first run may take a minute: it installs npm packages if `node_modules` is missing, creates `backend/.venv` and installs Python deps if needed, then starts **FastAPI** and **Vite** in one terminal. Press `Ctrl+C` to stop both.

**Ports:** if `8000` or `5173` are already in use (e.g. another HydroOptFoil or Vite), the dev runner picks the next free ports automatically and prints the real URLs. The Vite `/api` proxy follows `API_PORT`. Override with `API_PORT=8010 WEB_PORT=5180 npm start` if you want fixed ports.

Vite requires Node **20.19+** or **22.12+**; slightly older 22.x may print a warning but usually still runs—upgrade Node if anything fails.

Open the **UI** URL printed in the terminal (e.g. `http://localhost:5173` or another port).

## Manual two-process setup (optional)

**Backend only**

```bash
cd airfoil_optimiser_web/backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

The server adds `../airfoil_optimiser/hydrooptfoil` to `sys.path` so the existing `core.*` / `ui.*` imports keep working. The ASGI module is named **`server.py`** so it does not shadow `hydrooptfoil/app.py` (Streamlit).

**Frontend only** (when the API is already running)

```bash
cd airfoil_optimiser_web
npm install
npm run dev
```

### API smoke tests

```bash
cd airfoil_optimiser_web/backend
source .venv/bin/activate
pip install pytest-asyncio httpx
pytest tests/test_api.py -v
```

## Production build

```bash
npm run build
npm run preview   # serves dist/
```

Point your production reverse proxy at the FastAPI process and serve static files from `dist/`, or run the API with CORS configured for your host.

## Layout

| Path | Role |
|------|------|
| `backend/server.py` | FastAPI app: `/api/health`, `/api/meta`, `/api/flow`, `/api/seed/analyze`, `/api/optimize/jobs`, SSE `/api/optimize/jobs/{id}/events`, `/api/export`, `/api/dat/parse`, `/api/geometry/edge_locks` |
| `backend/schemas.py` | Pydantic models for optimisation config |
| `src/App.tsx` | Shell, optimisation job wiring |
| `src/components/Sidebar.tsx` | Configuration form (parity with Streamlit sidebar) |
| `src/components/*Tab.tsx` | Seed, Flow, Optimisation, Export tabs |

Optimisation jobs are stored **in memory** (single-process dev). For multiple workers or restarts, replace the job registry with Redis or similar.
