"""Thin async wrapper over `solana.rpc.async_api.AsyncClient`.

The CLI never talks to the RPC directly: it goes through this wrapper so
retries, timeouts, and cluster-aware WebSocket subscriptions are all in
one place. Instruction building lives in `commands/*.py`; this module
only owns the transport and a handful of read helpers.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Commitment
from solana.rpc.types import TxOpts
from solders.hash import Hash
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

from ghos_cli.config import Config
from ghos_cli.constants import (
    TX_CONFIRM_INTERVAL,
    TX_CONFIRM_MAX_RETRIES,
)
from ghos_cli.errors import RpcError, TransactionError

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Sequence

    from solders.instruction import Instruction


@dataclass(slots=True)
class SubmitResult:
    """Outcome of `GhosRpcClient.send_and_confirm`."""

    signature: str
    slot: int | None
    confirmation_status: str
    error: str | None


class GhosRpcClient:
    """Async RPC client with a small API tuned for ghos flows.

    The class is deliberately stateful: it owns an `AsyncClient` instance
    opened once and reused for every RPC in a command. Callers either
    use the `connected` async context manager or instantiate directly
    and call `close()` themselves.
    """

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._commitment = Commitment(cfg.cluster.commitment)
        self._client: AsyncClient | None = None

    @property
    def cfg(self) -> Config:
        """Return the underlying config snapshot."""
        return self._cfg

    async def __aenter__(self) -> GhosRpcClient:
        await self.open()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def open(self) -> None:
        """Open the underlying AsyncClient, idempotent."""
        if self._client is None:
            self._client = AsyncClient(
                endpoint=self._cfg.cluster.rpc_url,
                commitment=self._commitment,
            )

    async def close(self) -> None:
        """Close the underlying AsyncClient, idempotent."""
        if self._client is not None:
            try:
                await self._client.close()
            except Exception:  # noqa: BLE001 - best-effort close
                pass
            self._client = None

    def _require(self) -> AsyncClient:
        if self._client is None:
            raise RpcError("rpc client is not open, call open() or use 'async with'")
        return self._client

    async def get_latest_blockhash(self) -> Hash:
        """Fetch the latest blockhash used for transaction assembly."""
        client = self._require()
        try:
            resp = await client.get_latest_blockhash(commitment=self._commitment)
        except Exception as exc:  # noqa: BLE001 - normalize to RpcError
            raise RpcError(f"get_latest_blockhash failed: {exc}") from exc
        value = getattr(resp, "value", None)
        if value is None:
            raise RpcError("get_latest_blockhash returned no value")
        return value.blockhash

    async def get_balance(self, pubkey: Pubkey) -> int:
        """Return the lamport balance of `pubkey`."""
        client = self._require()
        try:
            resp = await client.get_balance(pubkey, commitment=self._commitment)
        except Exception as exc:  # noqa: BLE001
            raise RpcError(f"get_balance failed: {exc}") from exc
        value = getattr(resp, "value", None)
        if value is None:
            raise RpcError("get_balance returned no value")
        return int(value)

    async def get_account(self, pubkey: Pubkey) -> dict[str, Any] | None:
        """Return a dict description of an account, or None if not found."""
        client = self._require()
        try:
            resp = await client.get_account_info(pubkey, commitment=self._commitment)
        except Exception as exc:  # noqa: BLE001
            raise RpcError(f"get_account_info failed: {exc}") from exc
        value = getattr(resp, "value", None)
        if value is None:
            return None
        return {
            "lamports": getattr(value, "lamports", 0),
            "owner": str(getattr(value, "owner", "")),
            "executable": bool(getattr(value, "executable", False)),
            "rent_epoch": getattr(value, "rent_epoch", 0),
            "data": bytes(getattr(value, "data", b"")),
        }

    async def get_slot(self) -> int:
        """Return the current slot at the configured commitment."""
        client = self._require()
        try:
            resp = await client.get_slot(commitment=self._commitment)
        except Exception as exc:  # noqa: BLE001
            raise RpcError(f"get_slot failed: {exc}") from exc
        value = getattr(resp, "value", None)
        if value is None:
            raise RpcError("get_slot returned no value")
        return int(value)

    async def get_genesis_hash(self) -> str:
        """Return the genesis hash of the connected cluster."""
        client = self._require()
        try:
            resp = await client.get_genesis_hash()
        except Exception as exc:  # noqa: BLE001
            raise RpcError(f"get_genesis_hash failed: {exc}") from exc
        value = getattr(resp, "value", None)
        if value is None:
            raise RpcError("get_genesis_hash returned no value")
        return str(value)

    async def get_version(self) -> dict[str, Any]:
        """Return the cluster solana-core version metadata."""
        client = self._require()
        try:
            resp = await client.get_version()
        except Exception as exc:  # noqa: BLE001
            raise RpcError(f"get_version failed: {exc}") from exc
        value = getattr(resp, "value", None)
        if value is None:
            raise RpcError("get_version returned no value")
        return {
            "solana_core": getattr(value, "solana_core", ""),
            "feature_set": getattr(value, "feature_set", 0),
        }

    async def build_transaction(
        self,
        instructions: Sequence[Instruction],
        payer: Pubkey,
        signers: Sequence[Keypair],
    ) -> VersionedTransaction:
        """Construct and sign a V0 transaction over `instructions`."""
        recent_blockhash = await self.get_latest_blockhash()
        try:
            message = MessageV0.try_compile(
                payer=payer,
                instructions=list(instructions),
                address_lookup_table_accounts=[],
                recent_blockhash=recent_blockhash,
            )
        except Exception as exc:  # noqa: BLE001
            raise TransactionError(f"failed to compile transaction: {exc}") from exc
        try:
            tx = VersionedTransaction(message, list(signers))
        except Exception as exc:  # noqa: BLE001
            raise TransactionError(f"failed to sign transaction: {exc}") from exc
        return tx

    async def send_and_confirm(
        self,
        tx: VersionedTransaction,
        *,
        skip_preflight: bool = False,
    ) -> SubmitResult:
        """Send a signed transaction and poll until it is confirmed or fails.

        Raises:
            TransactionError: on simulation failure, RPC rejection, or
                permanent status errors reported by `getSignatureStatuses`.
        """
        client = self._require()
        opts = TxOpts(
            skip_preflight=skip_preflight,
            preflight_commitment=self._commitment,
            max_retries=3,
        )
        try:
            resp = await client.send_raw_transaction(bytes(tx), opts=opts)
        except Exception as exc:  # noqa: BLE001
            raise TransactionError(f"send_raw_transaction failed: {exc}") from exc
        signature = getattr(resp, "value", None)
        if signature is None:
            raise TransactionError("send_raw_transaction returned no signature")
        sig_str = str(signature)

        for _ in range(TX_CONFIRM_MAX_RETRIES):
            await asyncio.sleep(TX_CONFIRM_INTERVAL)
            try:
                status_resp = await client.get_signature_statuses([signature], search_transaction_history=True)
            except Exception as exc:  # noqa: BLE001
                raise RpcError(f"get_signature_statuses failed: {exc}") from exc
            statuses = getattr(status_resp, "value", [])
            if statuses and statuses[0] is not None:
                status = statuses[0]
                err = getattr(status, "err", None)
                conf_status = str(getattr(status, "confirmation_status", "") or "")
                slot = getattr(status, "slot", None)
                if err is not None:
                    raise TransactionError(f"transaction {sig_str} failed on chain: {err}")
                if conf_status in {"confirmed", "finalized"}:
                    return SubmitResult(
                        signature=sig_str,
                        slot=int(slot) if slot is not None else None,
                        confirmation_status=conf_status,
                        error=None,
                    )
        raise TransactionError(f"transaction {sig_str} was not confirmed within timeout")

    async def airdrop(self, pubkey: Pubkey, lamports: int) -> str:
        """Request an airdrop, returns the signature. Only works on devnet/testnet/local."""
        client = self._require()
        if lamports <= 0:
            raise RpcError(f"airdrop lamports must be positive, got {lamports}")
        try:
            resp = await client.request_airdrop(pubkey, lamports, commitment=self._commitment)
        except Exception as exc:  # noqa: BLE001
            raise RpcError(f"request_airdrop failed: {exc}") from exc
        value = getattr(resp, "value", None)
        if value is None:
            raise RpcError("request_airdrop returned no signature")
        return str(value)


@asynccontextmanager
async def connected(cfg: Config) -> AsyncIterator[GhosRpcClient]:
    """Open a `GhosRpcClient` for the duration of a command.

    Intended to be used inside each command handler as a single context
    manager rather than every handler having to remember to close.
    """
    client = GhosRpcClient(cfg)
    try:
        await client.open()
        yield client
    finally:
        await client.close()
