from __future__ import annotations

import hmac
import math
import os
import re
import time
import unicodedata
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, Boolean, DateTime, String, UniqueConstraint, create_engine, delete, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://finance:finance@localhost:5432/finance")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
PLUGGY_CLIENT_ID = os.getenv("PLUGGY_CLIENT_ID", "")
PLUGGY_CLIENT_SECRET = os.getenv("PLUGGY_CLIENT_SECRET", "")
PLUGGY_INCLUDE_SANDBOX = os.getenv("PLUGGY_INCLUDE_SANDBOX", "false").lower() == "true"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_NAME = "finance_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 14
PLUGGY_BASE_URL = "https://api.pluggy.ai"

engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"client_encoding": "UTF8"})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
serializer = URLSafeTimedSerializer(SESSION_SECRET or "missing-session-secret", salt="finance-manager-session")


class Base(DeclarativeBase):
    pass


class ApiDigest(Base):
    """Current raw API response snapshots. Financial fields stay inside JSONB unchanged."""

    __tablename__ = "api_digest"
    __table_args__ = (UniqueConstraint("item_id", "resource_type", "request_key", name="uq_digest_snapshot"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    item_id: Mapped[str] = mapped_column(String(120), index=True)
    resource_type: Mapped[str] = mapped_column(String(40), index=True)
    request_key: Mapped[str] = mapped_column(String(300))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    raw_json: Mapped[dict[str, Any]] = mapped_column(JSONB)


class CategoryOverride(Base):
    """Personal category edits. These never modify the Pluggy snapshot."""

    __tablename__ = "category_overrides"

    transaction_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    category: Mapped[str] = mapped_column(String(120))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RecurringPatternPreference(Base):
    """User-managed names, category allocations, and exclusions for recurring patterns."""

    __tablename__ = "recurring_pattern_preferences"

    pattern_key: Mapped[str] = mapped_column(String(500), primary_key=True)
    alias: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category_allocations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    excluded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class DisplayAliasPreference(Base):
    """User display names for linked institutions, bank accounts, and cards."""

    __tablename__ = "display_alias_preferences"

    alias_key: Mapped[str] = mapped_column(String(300), primary_key=True)
    alias: Mapped[str] = mapped_column(String(120))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PluggySyncState(Base):
    """Rate-limit automatic upstream sync attempts without altering API snapshots."""

    __tablename__ = "pluggy_sync_state"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


def get_db():
    with SessionLocal() as db:
        yield db


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return False
    try:
        claims = serializer.loads(token, max_age=SESSION_MAX_AGE)
        return claims == {"authenticated": True}
    except (BadSignature, TypeError, ValueError):
        return False


def require_auth(request: Request) -> None:
    if not APP_PASSWORD or not SESSION_SECRET:
        raise HTTPException(status_code=503, detail="Set APP_PASSWORD and SESSION_SECRET in the environment first.")
    if not is_authenticated(request):
        raise HTTPException(status_code=401, detail="Sign in to continue.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not APP_PASSWORD or not SESSION_SECRET:
        raise RuntimeError("APP_PASSWORD and SESSION_SECRET must be configured before starting the app.")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE recurring_pattern_preferences ADD COLUMN IF NOT EXISTS category_allocations JSONB"))
    with SessionLocal() as db:
        if db.get(PluggySyncState, "all-items") is None:
            db.add(PluggySyncState(key="all-items", last_attempt_at=None))
            db.commit()
    yield


app = FastAPI(title="Personal Finance Dashboard", version="1.0.0", lifespan=lifespan)


class LoginBody(BaseModel):
    password: str = Field(min_length=1, max_length=512)


class CategoryBody(BaseModel):
    category: str | None = Field(default=None, max_length=120)


class BulkCategoryBody(BaseModel):
    transaction_ids: list[str] = Field(min_length=1, max_length=1000)
    category: str | None = Field(default=None, max_length=120)


class RecurringPatternPreferenceBody(BaseModel):
    alias: str | None = Field(default=None, max_length=120)
    category_allocations: list[dict[str, Any]] = Field(default_factory=list, max_length=12)
    excluded: bool = False


class DisplayAliasPreferenceBody(BaseModel):
    alias_key: str = Field(min_length=1, max_length=300)
    alias: str | None = Field(default=None, max_length=120)


class PluggyClient:
    def __init__(self) -> None:
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(45, connect=15))

    async def close(self) -> None:
        await self.http.aclose()

    async def __aenter__(self) -> "PluggyClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.close()

    async def api_key(self) -> str:
        if not PLUGGY_CLIENT_ID or not PLUGGY_CLIENT_SECRET:
            raise HTTPException(status_code=503, detail="Add PLUGGY_CLIENT_ID and PLUGGY_CLIENT_SECRET to the environment to connect accounts.")
        if _api_key_cache["key"] and time.time() < _api_key_cache["expires_at"]:
            return str(_api_key_cache["key"])
        try:
            response = await self.http.post(
                f"{PLUGGY_BASE_URL}/auth",
                json={"clientId": PLUGGY_CLIENT_ID, "clientSecret": PLUGGY_CLIENT_SECRET},
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise pluggy_error(exc.response) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=f"Could not authenticate with Pluggy: {exc}") from exc
        key = payload.get("apiKey")
        if not key:
            raise HTTPException(status_code=502, detail="Pluggy did not return an API key.")
        _api_key_cache.update(key=key, expires_at=time.time() + 60 * 110)
        return str(key)

    async def request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        key = await self.api_key()
        try:
            response = await self.http.request(
                method,
                f"{PLUGGY_BASE_URL}{path}",
                headers={"X-API-KEY": key, "Accept": "application/json"},
                **kwargs,
            )
            response.raise_for_status()
            body = response.json()
            if not isinstance(body, dict):
                raise HTTPException(status_code=502, detail="Pluggy returned an unexpected response format.")
            return body
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                _api_key_cache.update(key=None, expires_at=0)
            raise pluggy_error(exc.response) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach Pluggy: {exc}") from exc


_api_key_cache: dict[str, Any] = {"key": None, "expires_at": 0.0}


def pluggy_error(response: httpx.Response) -> HTTPException:
    try:
        body = response.json()
        reason = body.get("message") or body.get("codeDescription") or response.reason_phrase
        error_code = body.get("code") or body.get("codeDescription")
    except ValueError:
        reason = response.reason_phrase
        error_code = None
    reason_text = str(reason).casefold()
    if response.status_code == 403 and (
        error_code == "LIST_ITEMS_FEATURE_NOT_ENABLED"
        or "not enabled to list its items" in reason_text
        or "list_items_feature_not_enabled" in reason_text
    ):
        return HTTPException(
            status_code=409,
            detail="Pluggy's existing-connection listing is not enabled for these API credentials. Ask Pluggy to enable GET /v2/items, or import a known Item ID below.",
        )
    return HTTPException(status_code=502, detail=f"Pluggy API returned {response.status_code}: {reason}")


def insert_snapshot(db: Session, item_id: str, resource_type: str, request_key: str, raw: dict[str, Any], fetched_at: datetime) -> None:
    db.add(ApiDigest(item_id=item_id, resource_type=resource_type, request_key=request_key, raw_json=raw, fetched_at=fetched_at))


def institution_display_name(account: dict[str, Any]) -> str | None:
    """Return a readable institution label from bank account metadata, if present."""
    candidates = [account.get("marketingName"), account.get("name")]
    normalized = " ".join(
        unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii").lower()
        for value in candidates if value
    )
    if "nu pagamentos" in normalized or "nubank" in normalized:
        return "Nubank"
    if "banrisul" in normalized:
        return "Banrisul"
    if "picpay" in normalized or "pic pay" in normalized:
        return "PicPay"

    for value in candidates:
        if not value:
            continue
        label = str(value).split("(", 1)[0].strip()
        ascii_label = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode("ascii")
        ascii_lower = ascii_label.lower()
        if ascii_lower in {"bank account", "checking account", "current account", "savings account", "conta corrente", "conta bancaria", "account"}:
            continue
        label = re.sub(r"(?i)\s*[-–]?\s*institui[cç][aã]o de pagamento\s*$", "", label).strip(" -–")
        label = re.sub(r"(?i)\s+(?:s\.?a\.?|s/a|ltda\.?)\s*$", "", label).strip()
        if label:
            return label.title() if label.isupper() else label
    return None


def persist_item_status(db: Session, item_id: str, item: dict[str, Any], fetched_at: datetime) -> None:
    db.rollback()
    with db.begin():
        existing = db.scalar(
            select(ApiDigest).where(
                ApiDigest.item_id == item_id,
                ApiDigest.resource_type == "item",
                ApiDigest.request_key == "item",
            )
        )
        if existing:
            existing.raw_json = item
            existing.fetched_at = fetched_at
        else:
            insert_snapshot(db, item_id, "item", "item", item, fetched_at)


async def page_numbered(pluggy: PluggyClient, path: str, params: dict[str, Any], page_size: int | None = 500) -> list[dict[str, Any]]:
    page_params = {**params, "page": 1}
    if page_size is not None:
        page_params["pageSize"] = page_size
    first = await pluggy.request("GET", path, params=page_params)
    pages = [first]
    total_pages = max(1, int(first.get("totalPages") or 1))
    for page in range(2, total_pages + 1):
        page_params = {**params, "page": page}
        if page_size is not None:
            page_params["pageSize"] = page_size
        pages.append(await pluggy.request("GET", path, params=page_params))
    return pages


async def sync_item_data(item_id: str, db: Session) -> dict[str, Any]:
    async with PluggyClient() as pluggy:
        item = await pluggy.request("GET", f"/items/{item_id}")
        fetched_at = datetime.now(timezone.utc)
        status = item.get("status")
        execution = item.get("executionStatus")
        if status != "UPDATED" or execution not in ("SUCCESS", "PARTIAL_SUCCESS"):
            persist_item_status(db, item_id, item, fetched_at)
            return {"itemId": item_id, "status": status, "executionStatus": execution, "synced": False}

        snapshots: list[tuple[str, str, dict[str, Any]]] = [("item", "item", item)]
        account_pages = await page_numbered(pluggy, "/accounts", {"itemId": item_id}, page_size=None)
        accounts: list[dict[str, Any]] = []
        for index, page in enumerate(account_pages, start=1):
            snapshots.append(("accounts", f"accounts:{index}", page))
            accounts.extend(page.get("results") or [])

        for account in accounts:
            account_id = str(account.get("id") or "")
            if not account_id:
                continue
            cursor: str | None = None
            transaction_page = 0
            while True:
                if cursor:
                    path = f"/v2/transactions{cursor}"
                    page = await pluggy.request("GET", path)
                else:
                    page = await pluggy.request("GET", "/v2/transactions", params={"accountId": account_id})
                transaction_page += 1
                snapshots.append(("transactions", f"transactions:{account_id}:{transaction_page}", page))
                cursor = page.get("next")
                if not cursor:
                    break

            if account.get("type") == "CREDIT":
                bill_pages = await page_numbered(pluggy, "/bills", {"accountId": account_id})
                for page_index, page in enumerate(bill_pages, start=1):
                    snapshots.append(("bills", f"bills:{account_id}:{page_index}", page))

    fetched_at = datetime.now(timezone.utc)
    db.rollback()
    with db.begin():
        db.execute(delete(ApiDigest).where(ApiDigest.item_id == item_id))
        for resource_type, request_key, payload in snapshots:
            insert_snapshot(db, item_id, resource_type, request_key, payload, fetched_at)
    return {"itemId": item_id, "status": status, "executionStatus": execution, "synced": True, "snapshotCount": len(snapshots), "syncedAt": fetched_at.isoformat()}


async def import_existing_items(db: Session) -> dict[str, Any]:
    """Discover existing Items, keep each raw list page in the digest, and sync each Item."""
    pages: list[dict[str, Any]] = []
    next_path = "/v2/items"
    async with PluggyClient() as pluggy:
        while next_path:
            page = await pluggy.request("GET", next_path)
            pages.append(page)
            cursor = page.get("next")
            next_path = f"/v2/items{cursor}" if cursor else ""

    fetched_at = datetime.now(timezone.utc)
    item_ids: list[str] = []
    for page in pages:
        for item in page.get("results") or []:
            item_id = str(item.get("id") or "")
            if item_id and item_id not in item_ids:
                item_ids.append(item_id)

    # This is a raw collection endpoint response, so store it in the same JSONB digest table.
    # The reserved collection key is bookkeeping only; no response fields are normalized here.
    collection_key = "__pluggy_items__"
    db.rollback()
    with db.begin():
        db.execute(delete(ApiDigest).where(ApiDigest.item_id == collection_key, ApiDigest.resource_type == "items"))
        for index, page in enumerate(pages, start=1):
            insert_snapshot(db, collection_key, "items", f"items:{index}", page, fetched_at)

    results: list[dict[str, Any]] = []
    for item_id in item_ids:
        try:
            results.append(await sync_item_data(item_id, db))
        except HTTPException as exc:
            results.append({"itemId": item_id, "synced": False, "error": exc.detail})
    return {"discovered": len(item_ids), "results": results}


@app.get("/api/session")
def session_status(request: Request):
    configured = bool(APP_PASSWORD and SESSION_SECRET)
    return {
        "authenticated": is_authenticated(request),
        "configured": configured,
        "pluggyConfigured": bool(PLUGGY_CLIENT_ID and PLUGGY_CLIENT_SECRET),
        "includeSandbox": PLUGGY_INCLUDE_SANDBOX,
    }


@app.post("/api/login")
def login(body: LoginBody, response: Response):
    if not APP_PASSWORD or not SESSION_SECRET:
        raise HTTPException(status_code=503, detail="Set APP_PASSWORD and SESSION_SECRET in the environment first.")
    if not hmac.compare_digest(body.password.encode("utf-8"), APP_PASSWORD.encode("utf-8")):
        raise HTTPException(status_code=401, detail="That password did not match.")
    token = serializer.dumps({"authenticated": True})
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="strict",
        path="/",
    )
    return {"authenticated": True}


@app.post("/api/logout", dependencies=[Depends(require_auth)])
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, secure=COOKIE_SECURE, samesite="strict")
    return {"authenticated": False}


@app.post("/api/import-existing", dependencies=[Depends(require_auth)])
async def import_existing(db: Session = Depends(get_db)):
    set_sync_attempt(db, datetime.now(timezone.utc))
    return await import_existing_items(db)


@app.post("/api/connect-token", dependencies=[Depends(require_auth)])
async def create_connect_token(itemId: str | None = None):
    async with PluggyClient() as pluggy:
        body: dict[str, Any] = {"options": {"avoidDuplicates": True}}
        if itemId:
            body["itemId"] = itemId
        result = await pluggy.request("POST", "/connect_token", json=body)
    # Credential/token responses are intentionally ephemeral; financial resource responses go into api_digest.
    return {"accessToken": result.get("accessToken")}


@app.post("/api/items/{item_id}/sync", dependencies=[Depends(require_auth)])
async def sync_one_item(item_id: str, db: Session = Depends(get_db)):
    set_sync_attempt(db, datetime.now(timezone.utc))
    return await sync_item_data(item_id, db)


async def sync_all_items(db: Session) -> dict[str, Any]:
    rows = db.scalars(select(ApiDigest).where(ApiDigest.resource_type == "item").order_by(ApiDigest.fetched_at.desc())).all()
    item_ids: list[str] = []
    for row in rows:
        if row.item_id not in item_ids:
            item_ids.append(row.item_id)
    results = []
    for item_id in item_ids:
        try:
            results.append(await sync_item_data(item_id, db))
        except HTTPException as exc:
            results.append({"itemId": item_id, "synced": False, "error": exc.detail})
    return {"results": results}


def set_sync_attempt(db: Session, attempted_at: datetime) -> PluggySyncState:
    state = db.scalar(select(PluggySyncState).where(PluggySyncState.key == "all-items").with_for_update())
    if state is None:
        state = PluggySyncState(key="all-items")
        db.add(state)
        db.flush()
    state.last_attempt_at = attempted_at
    db.commit()
    return state


@app.post("/api/sync", dependencies=[Depends(require_auth)])
async def sync_all(db: Session = Depends(get_db)):
    set_sync_attempt(db, datetime.now(timezone.utc))
    return await sync_all_items(db)


@app.post("/api/sync-if-due", dependencies=[Depends(require_auth)])
async def sync_all_if_due(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    state = db.scalar(select(PluggySyncState).where(PluggySyncState.key == "all-items").with_for_update())
    if state and state.last_attempt_at and now - state.last_attempt_at < timedelta(hours=1):
        db.rollback()
        return {"skipped": True, "lastAttemptAt": state.last_attempt_at.isoformat(), "results": []}
    set_sync_attempt(db, now)
    return {**await sync_all_items(db), "skipped": False, "lastAttemptAt": now.isoformat()}


@app.get("/api/dashboard", dependencies=[Depends(require_auth)])
def dashboard(db: Session = Depends(get_db)):
    snapshots = db.scalars(select(ApiDigest).order_by(ApiDigest.fetched_at.desc())).all()
    items_by_id: dict[str, dict[str, Any]] = {}
    accounts_by_id: dict[str, dict[str, Any]] = {}
    transactions_by_id: dict[str, dict[str, Any]] = {}
    bills_by_key: dict[str, dict[str, Any]] = {}
    last_synced_at: datetime | None = None

    for row in snapshots:
        raw = row.raw_json
        if last_synced_at is None or row.fetched_at > last_synced_at:
            last_synced_at = row.fetched_at
        if row.resource_type == "item":
            items_by_id.setdefault(row.item_id, raw)
        elif row.resource_type == "accounts":
            for account in raw.get("results") or []:
                accounts_by_id.setdefault(str(account.get("id")), account)
        elif row.resource_type == "transactions":
            for transaction in raw.get("results") or []:
                transactions_by_id.setdefault(str(transaction.get("id")), transaction)
        elif row.resource_type == "bills":
            account_id = row.request_key.split(":")[1] if ":" in row.request_key else ""
            for bill in raw.get("results") or []:
                bills_by_key.setdefault(f"{account_id}:{bill.get('id')}", {**bill, "_accountId": account_id})

    institution_by_item: dict[str, str] = {}
    for account in accounts_by_id.values():
        if account.get("type") != "BANK":
            continue
        item_id = str(account.get("itemId") or "")
        label = institution_display_name(account)
        if item_id and label:
            institution_by_item.setdefault(item_id, label)
    item_names = {}
    for item_id, item in items_by_id.items():
        connector = item.get("connector") or {}
        connector_name = connector.get("name") or connector.get("institution")
        if re.sub(r"\s+", "", str(connector_name or "").strip().casefold()).endswith("pluggy"):
            connector_name = None
        item_names[item_id] = institution_by_item.get(item_id) or connector_name or "Connected institution"
    # Return display-only item copies with institution labels; api_digest retains every raw response unchanged.
    items = [{
        **item,
        "id": item.get("id") or item_id,
        "connector": {**(item.get("connector") or {}), "name": item_names[item_id]},
    } for item_id, item in items_by_id.items()]
    accounts = [{
        **account,
        "_itemName": item_names.get(str(account.get("itemId")), "Connected institution"),
        "_institutionName": institution_by_item.get(str(account.get("itemId"))) or institution_display_name(account),
    } for account in accounts_by_id.values()]
    account_map = {str(account.get("id")): account for account in accounts}
    transactions = []
    for transaction in transactions_by_id.values():
        account = account_map.get(str(transaction.get("accountId")), {})
        transactions.append({
            **transaction,
            "_accountType": account.get("type"),
            "_accountName": account.get("name") or "Conta",
            "_itemName": account.get("_itemName"),
            "_itemId": account.get("itemId"),
        })
    transactions.sort(key=lambda tx: str(tx.get("date") or ""), reverse=True)
    overrides = {row.transaction_id: row.category for row in db.scalars(select(CategoryOverride)).all()}
    recurring_rules = {
        row.pattern_key: {"alias": row.alias, "categoryAllocations": row.category_allocations or [], "excluded": row.excluded}
        for row in db.scalars(select(RecurringPatternPreference)).all()
    }
    display_aliases = {
        row.alias_key: row.alias
        for row in db.scalars(select(DisplayAliasPreference)).all()
    }
    bills = list(bills_by_key.values())
    bills.sort(key=lambda bill: str(bill.get("dueDate") or ""), reverse=True)
    return {
        "items": items,
        "accounts": accounts,
        "transactions": transactions,
        "bills": bills,
        "categoryOverrides": overrides,
        "recurringRules": recurring_rules,
        "displayAliases": display_aliases,
        "lastSyncedAt": last_synced_at.isoformat() if last_synced_at else None,
    }


@app.patch("/api/transactions/{transaction_id}/category", dependencies=[Depends(require_auth)])
def set_transaction_category(transaction_id: str, body: CategoryBody, db: Session = Depends(get_db)):
    transaction_found = False
    pages = db.scalars(select(ApiDigest.raw_json).where(ApiDigest.resource_type == "transactions")).all()
    for page in pages:
        if any(str(tx.get("id")) == transaction_id for tx in (page.get("results") or [])):
            transaction_found = True
            break
    if not transaction_found:
        raise HTTPException(status_code=404, detail="Transaction not found in the latest Pluggy snapshots.")
    category = (body.category or "").strip()
    existing = db.get(CategoryOverride, transaction_id)
    if not category:
        if existing:
            db.delete(existing)
        db.commit()
        return {"transactionId": transaction_id, "category": None}
    if existing:
        existing.category = category
        existing.updated_at = datetime.now(timezone.utc)
    else:
        db.add(CategoryOverride(transaction_id=transaction_id, category=category, updated_at=datetime.now(timezone.utc)))
    db.commit()
    return {"transactionId": transaction_id, "category": category}


@app.patch("/api/transactions/categories", dependencies=[Depends(require_auth)])
def set_transaction_categories(body: BulkCategoryBody, db: Session = Depends(get_db)):
    transaction_ids = list(dict.fromkeys(transaction_id.strip() for transaction_id in body.transaction_ids if transaction_id.strip()))
    if not transaction_ids or any(len(transaction_id) > 160 for transaction_id in transaction_ids):
        raise HTTPException(status_code=400, detail="Provide valid transaction IDs.")

    pages = db.scalars(select(ApiDigest.raw_json).where(ApiDigest.resource_type == "transactions")).all()
    available_ids = {
        str(transaction.get("id"))
        for page in pages
        for transaction in (page.get("results") or [])
        if transaction.get("id")
    }
    missing_ids = [transaction_id for transaction_id in transaction_ids if transaction_id not in available_ids]
    if missing_ids:
        raise HTTPException(status_code=404, detail="One or more transactions are no longer in the latest snapshots.")

    category = (body.category or "").strip() or None
    for transaction_id in transaction_ids:
        existing = db.get(CategoryOverride, transaction_id)
        if not category:
            if existing:
                db.delete(existing)
        elif existing:
            existing.category = category
            existing.updated_at = datetime.now(timezone.utc)
        else:
            db.add(CategoryOverride(transaction_id=transaction_id, category=category, updated_at=datetime.now(timezone.utc)))
    db.commit()
    return {"transactionIds": transaction_ids, "category": category, "updated": len(transaction_ids)}


@app.put("/api/recurring-patterns/{pattern_key}", dependencies=[Depends(require_auth)])
def set_recurring_pattern_preference(
    pattern_key: str,
    body: RecurringPatternPreferenceBody,
    db: Session = Depends(get_db),
):
    key = pattern_key.strip()
    if not key or len(key) > 500:
        raise HTTPException(status_code=400, detail="Invalid recurring pattern key.")
    alias = (body.alias or "").strip() or None
    allocations_by_category: dict[str, dict[str, Any]] = {}
    for allocation in body.category_allocations:
        category = str(allocation.get("category") or "").strip()
        try:
            amount = round(float(allocation.get("amount")), 2)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Each category allocation needs a valid amount.")
        if not category or len(category) > 120 or not math.isfinite(amount) or amount <= 0 or amount > 1_000_000_000_000:
            raise HTTPException(status_code=422, detail="Each allocation needs a category and a positive amount.")
        key_lower = category.casefold()
        if key_lower in allocations_by_category:
            allocations_by_category[key_lower]["amount"] = round(allocations_by_category[key_lower]["amount"] + amount, 2)
        else:
            allocations_by_category[key_lower] = {"category": category, "amount": amount}
    category_allocations = list(allocations_by_category.values())
    existing = db.get(RecurringPatternPreference, key)
    if not alias and not category_allocations and not body.excluded:
        if existing:
            db.delete(existing)
        db.commit()
        return {"patternKey": key, "alias": None, "categoryAllocations": [], "excluded": False}
    if existing:
        existing.alias = alias
        existing.category_allocations = category_allocations or None
        existing.excluded = body.excluded
        existing.updated_at = datetime.now(timezone.utc)
    else:
        db.add(RecurringPatternPreference(
            pattern_key=key,
            alias=alias,
            category_allocations=category_allocations or None,
            excluded=body.excluded,
            updated_at=datetime.now(timezone.utc),
        ))
    db.commit()
    return {"patternKey": key, "alias": alias, "categoryAllocations": category_allocations, "excluded": body.excluded}


@app.put("/api/display-aliases", dependencies=[Depends(require_auth)])
def set_display_alias(body: DisplayAliasPreferenceBody, db: Session = Depends(get_db)):
    alias_key = body.alias_key.strip()
    if not re.fullmatch(r"(?:institution|account|card):[^:/\s]{1,240}", alias_key):
        raise HTTPException(status_code=400, detail="Alias key must identify an institution, account, or card.")
    alias = (body.alias or "").strip() or None
    existing = db.get(DisplayAliasPreference, alias_key)
    if not alias:
        if existing:
            db.delete(existing)
        db.commit()
        return {"aliasKey": alias_key, "alias": None}
    if existing:
        existing.alias = alias
        existing.updated_at = datetime.now(timezone.utc)
    else:
        db.add(DisplayAliasPreference(
            alias_key=alias_key,
            alias=alias,
            updated_at=datetime.now(timezone.utc),
        ))
    db.commit()
    return {"aliasKey": alias_key, "alias": alias}
