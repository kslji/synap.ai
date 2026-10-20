"""Concurrency management for the gateway: per-user semaphores, circuit breakers, and request queuing."""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, AsyncIterator

log = logging.getLogger("surf.gateway.concurrency")


class CircuitState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"  # Normal operation, requests pass through
    OPEN = "open"  # Circuit tripped, requests fail fast
    HALF_OPEN = "half_open"  # Testing if service recovered


@dataclass
class CircuitBreaker:
    """Circuit breaker for external API calls (OpenRouter).
    
    Prevents cascading failures when OpenRouter is down or rate-limited.
    
    States:
    - CLOSED: Normal operation, requests pass through
    - OPEN: Circuit tripped after N failures, requests fail immediately
    - HALF_OPEN: Testing if service recovered after timeout
    """
    failure_threshold: int = 5  # Number of failures before opening
    recovery_timeout: float = 60.0  # Seconds to wait before half-open
    success_threshold: int = 2  # Successes needed in half-open to close
    
    state: CircuitState = field(default=CircuitState.CLOSED, init=False)
    failure_count: int = field(default=0, init=False)
    success_count: int = field(default=0, init=False)
    last_failure_time: float = field(default=0.0, init=False)
    
    def can_execute(self) -> bool:
        """Check if request can proceed based on circuit state."""
        if self.state == CircuitState.CLOSED:
            return True
        
        if self.state == CircuitState.OPEN:
            # Check if recovery timeout has elapsed
            if time.time() - self.last_failure_time >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                self.success_count = 0
                log.info("Circuit breaker transitioning to HALF_OPEN")
                return True
            return False
        
        # HALF_OPEN: Allow requests for testing
        return True
    
    def record_success(self) -> None:
        """Record a successful request."""
        if self.state == CircuitState.HALF_OPEN:
            self.success_count += 1
            if self.success_count >= self.success_threshold:
                self.state = CircuitState.CLOSED
                self.failure_count = 0
                log.info("Circuit breaker CLOSED after successful recovery")
        else:
            # Reset failure count on success
            self.failure_count = 0
    
    def record_failure(self) -> None:
        """Record a failed request."""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.state == CircuitState.HALF_OPEN:
            # Any failure in half-open immediately opens circuit
            self.state = CircuitState.OPEN
            log.warning("Circuit breaker re-OPENED during half-open test")
        elif self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            log.warning(f"Circuit breaker OPENED after {self.failure_count} failures")


@dataclass
class UserConcurrency:
    """Per-user concurrency control."""
    semaphore: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(1))
    active_requests: int = 0
    last_request_time: float = 0.0
    total_requests: int = 0


class ConcurrencyManager:
    """Manages concurrent access to the gateway with per-user limits and circuit breaking.
    
    Key features:
    1. Per-user semaphores: Prevent same user from making multiple simultaneous requests
    2. Circuit breaker: Protect against OpenRouter outages
    3. Request tracking: Monitor concurrent load
    4. Automatic cleanup: Remove stale user entries
    
    Usage:
        manager = ConcurrencyManager(max_concurrent_per_user=1)
        
        async with manager.user_scope(user_id):
            if not manager.circuit_breaker.can_execute():
                raise HTTPException(503, "Service temporarily unavailable")
            
            try:
                response = await call_openrouter(...)
                manager.circuit_breaker.record_success()
            except Exception as e:
                manager.circuit_breaker.record_failure()
                raise
    """
    
    def __init__(
        self,
        max_concurrent_per_user: int = 1,
        cleanup_interval: float = 300.0,  # 5 minutes
        stale_threshold: float = 600.0,  # 10 minutes
        circuit_breaker: CircuitBreaker | None = None,
    ):
        self.max_concurrent_per_user = max_concurrent_per_user
        self.cleanup_interval = cleanup_interval
        self.stale_threshold = stale_threshold
        
        # Per-user concurrency tracking
        self._user_concurrency: dict[str, UserConcurrency] = defaultdict(
            lambda: UserConcurrency(semaphore=asyncio.Semaphore(max_concurrent_per_user))
        )
        
        # Circuit breaker for OpenRouter
        self.circuit_breaker = circuit_breaker or CircuitBreaker()
        
        # Global metrics
        self._total_active_requests = 0
        self._lock = asyncio.Lock()
        
        # Start cleanup task
        self._cleanup_task: asyncio.Task | None = None
    
    async def start(self) -> None:
        """Start background cleanup task."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            log.info("ConcurrencyManager started")
    
    async def stop(self) -> None:
        """Stop background cleanup task."""
        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
            log.info("ConcurrencyManager stopped")
    
    async def _cleanup_loop(self) -> None:
        """Periodically clean up stale user entries."""
        while True:
            await asyncio.sleep(self.cleanup_interval)
            await self._cleanup_stale_users()
    
    async def _cleanup_stale_users(self) -> None:
        """Remove user entries that haven't been used recently."""
        now = time.time()
        stale_users = [
            user_id
            for user_id, uc in self._user_concurrency.items()
            if now - uc.last_request_time > self.stale_threshold and uc.active_requests == 0
        ]
        
        for user_id in stale_users:
            del self._user_concurrency[user_id]
        
        if stale_users:
            log.debug(f"Cleaned up {len(stale_users)} stale user entries")
    
    @asynccontextmanager
    async def user_scope(self, user_id: str) -> AsyncIterator[UserConcurrency]:
        """Context manager for per-user concurrency control.
        
        Ensures only N concurrent requests per user (default: 1).
        
        Raises:
            asyncio.TimeoutError: If user already has max concurrent requests
        """
        uc = self._user_concurrency[user_id]
        uc.last_request_time = time.time()
        uc.total_requests += 1
        
        # Try to acquire semaphore with timeout
        try:
            # Non-blocking check first
            if uc.semaphore._value <= 0:
                log.warning(f"User {user_id} already has {uc.active_requests} active requests")
                raise asyncio.TimeoutError("User has too many concurrent requests")
            
            await uc.semaphore.acquire()
            uc.active_requests += 1
            
            async with self._lock:
                self._total_active_requests += 1
            
            try:
                yield uc
            finally:
                uc.active_requests -= 1
                uc.semaphore.release()
                
                async with self._lock:
                    self._total_active_requests -= 1
        
        except asyncio.TimeoutError:
            raise
    
    @property
    def total_active_requests(self) -> int:
        """Get total number of active requests across all users."""
        return self._total_active_requests
    
    def get_user_stats(self, user_id: str) -> dict:
        """Get concurrency stats for a specific user."""
        uc = self._user_concurrency.get(user_id)
        if not uc:
            return {"active_requests": 0, "total_requests": 0}
        return {
            "active_requests": uc.active_requests,
            "total_requests": uc.total_requests,
            "last_request_time": uc.last_request_time,
        }
    
    def get_global_stats(self) -> dict:
        """Get global concurrency metrics."""
        return {
            "total_active_requests": self._total_active_requests,
            "total_users": len(self._user_concurrency),
            "circuit_state": self.circuit_breaker.state.value,
            "circuit_failures": self.circuit_breaker.failure_count,
        }
