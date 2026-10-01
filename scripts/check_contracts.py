"""Validate exported contract drift and every JSON request example in the frontend API reference."""

import json
import re
from pathlib import Path

from app import schemas
from app.config import Settings
from app.main import create_app

ROOT = Path(__file__).resolve().parents[1]


def main():
    contract = json.loads((ROOT / "docs/openapi.json").read_text(encoding="utf-8"))
    app = create_app(Settings(app_env="test", _env_file=None))
    try:
        assert app.openapi() == contract, "OpenAPI export is stale; run scripts/export_contracts.py"
    finally:
        app.state.auth_http.close()
        app.state.engine.dispose()
    text = (ROOT / "docs/api.md").read_text(encoding="utf-8")
    validated = 0
    for section in re.split(r"\n## ", text)[1:]:
        heading, _, body = section.partition("\n")
        method, path = heading.split(" ", 1)
        examples = re.findall(r"```json\n(.*?)\n```", body, re.DOTALL)
        for example in examples:
            ref = contract["paths"][path][method.lower()]["requestBody"]["content"]["application/json"][
                "schema"
            ]["$ref"]
            schema = getattr(schemas, ref.rsplit("/", 1)[1])
            schema.model_validate_json(example)
            validated += 1
    print(f"OpenAPI matches the application; {validated} JSON request examples validate")


if __name__ == "__main__":
    main()
