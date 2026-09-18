import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.main import create_app
from app.review import added_lines


def payload() -> dict:
    return {
        "repository": "demo",
        "branch": "feature/demo",
        "files": [
            {
                "path": "payments.py",
                "diff": '@@ -1 +1,2 @@\n unchanged\n+password = "demo-only"\n',
            }
        ],
    }


def test_health_and_mock_review() -> None:
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.get("/api/v1/health").json()["version"] == "0.1.0"
        response = client.post("/api/v1/reviews", json=payload())
        assert response.status_code == 200
        result = response.json()
        assert result["provider"] == "mock"
        assert result["findings"][0]["start_line"] == 2
        assert result["findings"][0]["verification_status"] == "POSSIBLE"
        assert "demo-only" not in response.text


def test_auth_and_noise_filter() -> None:
    settings = Settings(_env_file=None, verireview_api_key=SecretStr("test-key"))
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/v1/reviews", json=payload()).status_code == 401
        data = payload()
        data["minimum_confidence"] = 0.9
        response = client.post(
            "/api/v1/reviews", json=data, headers={"X-VeriReview-Key": "test-key"}
        )
        assert response.json()["findings"] == []


@pytest.mark.parametrize("path", ["../secret", "/etc/passwd", "C:/secret", "a\\b", "a/../b"])
def test_unsafe_paths_rejected_without_echo(path: str) -> None:
    data = payload()
    data["files"][0]["path"] = path
    with TestClient(create_app(Settings(_env_file=None))) as client:
        response = client.post("/api/v1/reviews", json=data)
        assert response.status_code == 422
        assert "demo-only" not in response.text


def test_request_size_limit() -> None:
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.post("/api/v1/reviews", content=b"x" * 1_000_001).status_code == 413


def test_production_requires_key() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", verireview_api_key=SecretStr(""))


def test_hunk_positions_and_removed_lines() -> None:
    diff = "--- a/test.py\n+++ b/test.py\n@@ -3,2 +3,3 @@\n-old\n context\n+++value\n+new\n"
    assert list(added_lines(diff)) == [(4, "++value"), (5, "new")]
