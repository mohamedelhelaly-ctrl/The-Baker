"""One error shape for the whole API: {"error": {"code", "message", "fields"?}}."""

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(status_code=status_code, detail=message)
        self.code = code


def _body(code: str, message: str, fields: dict | None = None) -> dict:
    error: dict = {"code": code, "message": message}
    if fields:
        error["fields"] = fields
    return {"error": error}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError):
        return JSONResponse(
            _body(exc.code, str(exc.detail)), status_code=exc.status_code, headers=exc.headers
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}
        return JSONResponse(
            _body(code.get(exc.status_code, "error"), str(exc.detail)),
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        fields: dict[str, str] = {}
        for err in exc.errors():
            loc = [str(p) for p in err["loc"] if p not in ("body", "query", "path")]
            fields[".".join(loc) or "request"] = err["msg"].removeprefix("Value error, ")
        return JSONResponse(
            _body("validation_error", "Please check the highlighted fields.", fields),
            status_code=422,
        )
