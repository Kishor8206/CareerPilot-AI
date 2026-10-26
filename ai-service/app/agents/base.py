"""Multi-agent framework (§5).

Every agent declares:
  * a stable `name`
  * a Pydantic `InputModel` and `OutputModel`  (input/output schema + validation)
  * a `handle()` coroutine containing the actual work

`BaseAgent.run()` wraps that with validation, structured logging, latency
measurement and error containment, so no agent has to reimplement them and no
agent can return an unvalidated payload.

Orchestration rule
------------------
Agents never call each other directly. Composition happens in
`app.agents.orchestrator`, which owns the controlled workflows. This keeps the
call graph acyclic and auditable - an agent cannot trigger an unbounded chain.
"""
from __future__ import annotations

import abc
import time
from typing import Any, ClassVar, Generic, TypeVar

from pydantic import BaseModel, ValidationError

from app.core.errors import AgentValidationError, ServiceError
from app.core.logging import get_logger

TInput = TypeVar("TInput", bound=BaseModel)
TOutput = TypeVar("TOutput", bound=BaseModel)


class AgentRunMeta(BaseModel):
    agent: str
    latencyMs: int
    provider: str = "internal"
    model: str | None = None
    tokensPrompt: int = 0
    tokensCompletion: int = 0
    ragSourceCount: int = 0
    degraded: bool = False
    notice: str | None = None


class AgentResult(BaseModel, Generic[TOutput]):
    data: TOutput
    meta: AgentRunMeta


class BaseAgent(abc.ABC, Generic[TInput, TOutput]):
    #: Stable identifier, mirrored by `AgentName` in shared/src/enums.ts.
    name: ClassVar[str] = "BASE"
    #: One-line statement of the agent's single responsibility.
    responsibility: ClassVar[str] = ""

    InputModel: ClassVar[type[BaseModel]]
    OutputModel: ClassVar[type[BaseModel]]

    def __init__(self) -> None:
        self.log = get_logger(f"agent.{self.name.lower()}")

    @abc.abstractmethod
    async def handle(self, payload: TInput) -> tuple[TOutput, dict[str, Any]]:
        """Performs the agent's work.

        Returns the output model plus a dict of meta fields (provider, model,
        token counts) that `run()` folds into `AgentRunMeta`.
        """

    async def run(self, raw_input: dict[str, Any]) -> AgentResult:
        started = time.perf_counter()

        try:
            payload = self.InputModel.model_validate(raw_input)
        except ValidationError as exc:
            self.log.warning("Agent input failed validation", extra={"errors": exc.error_count()})
            raise AgentValidationError(
                f"The input supplied to the {self.name} agent is invalid.",
                details=[{"path": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()],
            ) from exc

        try:
            output, meta = await self.handle(payload)  # type: ignore[arg-type]
        except ServiceError:
            raise
        except Exception as exc:
            self.log.exception("Agent execution failed")
            raise ServiceError(
                f"The {self.name} agent could not complete this request. Please try again.",
                code="AGENT_EXECUTION_FAILED",
                status_code=500,
            ) from exc

        try:
            validated = self.OutputModel.model_validate(
                output if isinstance(output, dict) else output.model_dump()
            )
        except ValidationError as exc:
            # An agent producing malformed output is a bug, not a user error;
            # failing loudly here stops bad data reaching the database.
            self.log.error("Agent output failed its own schema", extra={"errors": exc.error_count()})
            raise AgentValidationError(
                f"The {self.name} agent produced a response that did not match its output schema.",
                details=[{"path": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()],
            ) from exc

        latency_ms = int((time.perf_counter() - started) * 1000)
        self.log.info("Agent completed", extra={"latencyMs": latency_ms, "agent": self.name})

        return AgentResult(
            data=validated,
            meta=AgentRunMeta(agent=self.name, latencyMs=latency_ms, **meta),
        )

    @classmethod
    def describe(cls) -> dict[str, Any]:
        """Self-documentation surfaced at `/ai/agents` for the admin console."""
        return {
            "name": cls.name,
            "responsibility": cls.responsibility,
            "inputSchema": cls.InputModel.model_json_schema(),
            "outputSchema": cls.OutputModel.model_json_schema(),
        }
