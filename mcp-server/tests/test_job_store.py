"""
Unit tests for mcp-server/job_store.py.

All HTTP calls to auth-service are mocked so tests run without a real backend.
"""
import asyncio
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _fast_engine(payload: dict) -> dict:
    """Instant-return engine for happy-path tests."""
    return {"status": "processed", "echo": payload}


async def _error_engine(payload: dict) -> dict:
    """Always raises so error-path is exercised."""
    raise ValueError("engine exploded")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(autouse=True)
async def reset_job_store():
    """Ensure job_store module state is clean before every test."""
    import job_store
    job_store._ENGINE_FNS.clear()
    job_store._notify_complete = None
    yield
    job_store._ENGINE_FNS.clear()
    job_store._notify_complete = None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_submit_stores_pending_and_creates_task():
    """submit_job registers engine_fn and spawns a background task."""
    import job_store

    with patch("httpx.AsyncClient") as MockClient:
        mock_http = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_http.post = AsyncMock()
        mock_http.put = AsyncMock()

        await job_store.submit_job(
            job_id="job-1",
            thread_id="thread-1",
            business_id=42,
            engine_name="test_engine",
            payload={"x": 1},
            engine_fn=_fast_engine,
        )

        # Engine fn is stored while task is running (it may already have been popped
        # by the time we check if the event loop runs the task immediately, so we
        # just verify submit_job completed without error and HTTP post was called).
        mock_http.post.assert_awaited_once()
        post_call = mock_http.post.call_args
        assert post_call.kwargs["json"]["job_id"] == "job-1"
        assert post_call.kwargs["json"]["thread_id"] == "thread-1"


@pytest.mark.asyncio
async def test_job_completes_on_fast_engine():
    """Fast engine → PUT with status=completed and result populated."""
    import job_store

    put_payloads = []

    async def fake_put(url, *, json=None, **kw):
        put_payloads.append(json)
        return MagicMock(is_success=True)

    with patch("httpx.AsyncClient") as MockClient:
        mock_http = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_http.post = AsyncMock()
        mock_http.put = AsyncMock(side_effect=fake_put)

        await job_store.submit_job(
            job_id="job-2",
            thread_id="thread-2",
            business_id=1,
            engine_name="fast",
            payload={"k": "v"},
            engine_fn=_fast_engine,
        )

        # Allow the background task to finish
        await asyncio.sleep(0.05)

        assert len(put_payloads) == 1
        assert put_payloads[0]["status"] == "completed"
        assert put_payloads[0]["result"]["echo"] == {"k": "v"}


@pytest.mark.asyncio
async def test_job_error_captured():
    """Engine that raises → PUT with status=error and error message."""
    import job_store

    put_payloads = []

    async def fake_put(url, *, json=None, **kw):
        put_payloads.append(json)
        return MagicMock(is_success=True)

    with patch("httpx.AsyncClient") as MockClient:
        mock_http = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_http.post = AsyncMock()
        mock_http.put = AsyncMock(side_effect=fake_put)

        await job_store.submit_job(
            job_id="job-3",
            thread_id="thread-3",
            business_id=1,
            engine_name="err",
            payload={},
            engine_fn=_error_engine,
        )

        await asyncio.sleep(0.05)

        assert len(put_payloads) == 1
        assert put_payloads[0]["status"] == "error"
        assert "engine exploded" in put_payloads[0]["error"]


@pytest.mark.asyncio
async def test_notify_called_on_complete():
    """notify_complete callback is invoked after a job finishes."""
    import job_store

    notify_calls = []

    async def fake_notify(job_id: str, update: dict):
        notify_calls.append((job_id, update))

    job_store.set_notify_callback(fake_notify)

    with patch("httpx.AsyncClient") as MockClient:
        mock_http = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_http.post = AsyncMock()
        mock_http.put = AsyncMock()

        await job_store.submit_job(
            job_id="job-4",
            thread_id="thread-4",
            business_id=1,
            engine_name="fast",
            payload={"a": 1},
            engine_fn=_fast_engine,
        )

        await asyncio.sleep(0.05)

        assert len(notify_calls) == 1
        job_id, update = notify_calls[0]
        assert job_id == "job-4"
        assert update["status"] == "completed"


@pytest.mark.asyncio
async def test_notify_called_on_error():
    """notify_complete callback is invoked even when the engine raises."""
    import job_store

    notify_calls = []

    async def fake_notify(job_id: str, update: dict):
        notify_calls.append((job_id, update))

    job_store.set_notify_callback(fake_notify)

    with patch("httpx.AsyncClient") as MockClient:
        mock_http = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_http.post = AsyncMock()
        mock_http.put = AsyncMock()

        await job_store.submit_job(
            job_id="job-5",
            thread_id="thread-5",
            business_id=1,
            engine_name="err",
            payload={},
            engine_fn=_error_engine,
        )

        await asyncio.sleep(0.05)

        assert len(notify_calls) == 1
        _, update = notify_calls[0]
        assert update["status"] == "error"
