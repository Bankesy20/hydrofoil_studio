"""In-memory optimisation jobs with cooperative cancellation."""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class OptimizeJob:
    job_id: str
    cancel_event: threading.Event = field(default_factory=threading.Event)
    status: str = "pending"  # pending | running | completed | failed | cancelled
    events: list[dict[str, Any]] = field(default_factory=list)
    result: dict[str, Any] | None = None
    error: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def append_event(self, payload: dict[str, Any]) -> None:
        with self.lock:
            self.events.append(payload)

    def drain_events(self, start: int) -> tuple[list[dict[str, Any]], int]:
        with self.lock:
            chunk = self.events[start:]
            return chunk, len(self.events)


class JobRegistry:
    def __init__(self) -> None:
        self._jobs: dict[str, OptimizeJob] = {}
        self._lock = threading.Lock()

    def create(self) -> OptimizeJob:
        jid = str(uuid.uuid4())
        job = OptimizeJob(job_id=jid)
        with self._lock:
            self._jobs[jid] = job
        return job

    def get(self, job_id: str) -> OptimizeJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None or job.status in ("completed", "failed", "cancelled"):
            return False
        job.cancel_event.set()
        return True


def run_optimize_thread(
    job: OptimizeJob,
    config: dict[str, Any],
    run_optimization: Callable[..., dict[str, Any]],
    serialize: Callable[[dict[str, Any]], dict[str, Any]],
) -> None:
    cfg = dict(config)
    # Do not attach threading objects or bound methods to cfg: SciPy's
    # differential_evolution uses multiprocessing when workers>1 and must
    # pickle (func, args). A threading.Event / is_set handle breaks pickling
    # and surfaces as a misleading "map-like callable" RuntimeError.

    def _cb(iteration: int, best_value: float, total_iterations: int) -> None:
        job.append_event(
            {
                "type": "progress",
                "iteration": iteration,
                "best_objective": best_value,
                "total_iterations": total_iterations,
            }
        )

    try:
        job.status = "running"
        raw = run_optimization(cfg, callback=_cb)
        if job.cancel_event.is_set():
            job.status = "cancelled"
            job.append_event({"type": "done", "status": "cancelled"})
            return
        with job.lock:
            job.result = serialize(raw)
            job.status = "completed"
        job.append_event({"type": "done", "status": "completed"})
    except Exception as exc:  # noqa: BLE001
        with job.lock:
            job.error = str(exc)
            job.status = "failed"
        job.append_event({"type": "done", "status": "failed", "error": str(exc)})
