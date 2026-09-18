import hmac
import json
import logging
import shutil
from time import perf_counter
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import __version__
from app.config import Settings
from app.models import HealthResponse, ReviewRequest, ReviewResponse
from app.review import MockReviewProvider, ReviewOrchestrator

logger = logging.getLogger("verireview")


class BodyLimitMiddleware:
    """Bound actual streamed bytes, including requests without Content-Length."""

    def __init__(self, app: ASGIApp, maximum: int = 1_000_000) -> None:
        self.app = app
        self.maximum = maximum

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.maximum:
                await JSONResponse({"detail": "Request exceeds 1 MB limit"}, 413)(
                    scope, receive, send
                )
                return
            if not message.get("more_body", False):
                break

        async def replay() -> Message:
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()
    application = FastAPI(title="VeriReview AI", version=__version__)
    application.add_middleware(BodyLimitMiddleware)
    engine = ReviewOrchestrator(MockReviewProvider())

    async def authenticate(x_verireview_key: str = Header(default="")) -> None:
        expected = config.verireview_api_key.get_secret_value()
        if expected and not hmac.compare_digest(x_verireview_key.encode(), expected.encode()):
            raise HTTPException(401, "Invalid or missing API key")

    @application.exception_handler(RequestValidationError)
    async def validation_error(_request: object, exc: RequestValidationError) -> JSONResponse:
        # Pydantic's default error includes input; source snippets must not be reflected.
        errors = [{"loc": e["loc"], "type": e["type"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @application.get("/api/v1/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            version=__version__,
            ai_provider=config.ai_provider,
            ai_configured=True,
            semgrep_available=shutil.which("semgrep") is not None,
        )

    @application.post(
        "/api/v1/reviews", response_model=ReviewResponse, dependencies=[Depends(authenticate)]
    )
    async def review(request: ReviewRequest) -> ReviewResponse:
        request_id = str(uuid4())
        start = perf_counter()
        result = await engine.run(request)
        logger.info(
            json.dumps(
                {
                    "event": "review_completed",
                    "request_id": request_id,
                    "review_id": result.review_id,
                    "files": result.files_reviewed,
                    "duration_ms": int((perf_counter() - start) * 1000),
                }
            )
        )
        return result

    return application


app = create_app()
