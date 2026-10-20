"""Global rate limiting and request queuing for OpenRouter API protection."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator

log = logging.getLogger("surf.gateway.rate_limiter")


class RateLimitStrategy(Enum):
    """Rate limiting strategies."""
    TOKEN_BUCKET = "token_bucket"  # Smooth rate limiting
    FIXED_WINDOW = "fixed_window"  # Simple window-based
    SLIDING_WINDOW = "sliding_window"  # More accurate window


@dataclass
class RateLimitConfig:
    """Configuration for rate limiting."""
    # Global limits (across all users)
    max_requests_per_second: float = 50.0  # OpenRouter rate limit
    max_requests_per_minute: float = 1000.0
    max_concurrent_requests: int = 100  # Max simultaneous in-flight requests
    
    # Token bucket settings
    token_bucket_capacity: int = 100
    token_refill_rate: float = 50.0  # tokens per second
    
    # Queue settings
    max_queue_size: int = 500
    queue_timeout: float = 30.0  # seconds to wait in queue
    
    # Backoff settings
    initial_backoff: float = 1.0
    max_backoff: float = 60.0
    backoff_multiplier: float = 2.0


@dataclass
class QueuedRequest:
    """A request waiting in the queue."""
    user_id: str
    request_id: str
    future: asyncio.Future
    enqueue_time: float = field(default_factory=time.time)
    priority: int = 0  # Higher = more urgent


class GlobalRateLimiter:
    """Global rate limiter protecting OpenRouter API from overwhelming traffic.
    
    Features:
    1. Token bucket algorithm for smooth rate limiting
    2. Request queue when at capacity
    3. Per-model rate limits (future enhancement)
    4. Backpressure signaling
    5. Automatic backoff on rate limit errors
    
    Usage:
        limiter = GlobalRateLimiter(config)
        await limiter.start()
        
        async with limiter.acquire(user_id, request_id):
            response = await call_openrouter(...)
    """
    
    def __init__(self, config: RateLimitConfig | None = None):
        self.config = config or RateLimitConfig()
        
        # Token bucket state
        self._tokens = float(self.config.token_bucket_capacity)
        self._last_refill_time = time.time()
        self._token_lock = asyncio.Lock()
        
        # Request queue
        self._queue: deque[QueuedRequest] = deque()
        self._queue_lock = asyncio.Lock()
        self._active_requests: set[str] = set()
        
        # Metrics
        self._total_requests = 0
        self._total_queued = 0
        self._total_rejected = 0
        self._total_rate_limited = 0
        
        # Background tasks
        self._refill_task: asyncio.Task | None = None
        self._process_queue_task: asyncio.Task | None = None
        
        # Backoff state
        self._current_backoff = self.config.initial_backoff
        self._last_rate_limit_error = 0.0
    
    async def start(self) -> None:
        """Start background tasks for token refill and queue processing."""
        self._refill_task = asyncio.create_task(self._refill_loop())
        self._process_queue_task = asyncio.create_task(self._process_queue_loop())
        log.info(
            "GlobalRateLimiter started (max_rps=%.1f, max_concurrent=%d, queue_size=%d)",
            self.config.max_requests_per_second,
            self.config.max_concurrent_requests,
            self.config.max_queue_size,
        )
    
    async def stop(self) -> None:
        """Stop background tasks."""
        if self._refill_task:
            self._refill_task.cancel()
            try:
                await self._refill_task
            except asyncio.CancelledError:
                pass
        
        if self._process_queue_task:
            self._process_queue_task.cancel()
            try:
                await self._process_queue_task
            except asyncio.CancelledError:
                pass
        
        # Reject all queued requests
        async with self._queue_lock:
            while self._queue:
                req = self._queue.popleft()
                if not req.future.done():
                    req.future.set_exception(
                        asyncio.TimeoutError("Rate limiter shutting down")
                    )
        
        log.info("GlobalRateLimiter stopped")
    
    async def _refill_loop(self) -> None:
        """Refill tokens at the configured rate."""
        while True:
            await asyncio.sleep(0.1)  # Refill 10 times per second
            await self._refill_tokens()
    
    async def _refill_tokens(self) -> None:
        """Refill tokens based on elapsed time."""
        async with self._token_lock:
            now = time.time()
            elapsed = now - self._last_refill_time
            tokens_to_add = elapsed * self.config.token_refill_rate
            
            self._tokens = min(
                self.config.token_bucket_capacity,
                self._tokens + tokens_to_add
            )
            self._last_refill_time = now
    
    async def _process_queue_loop(self) -> None:
        """Process queued requests when capacity is available."""
        while True:
            await asyncio.sleep(0.05)  # Check 20 times per second
            await self._process_queue()
    
    async def _process_queue(self) -> None:
        """Process queued requests if capacity available."""
        async with self._queue_lock:
            if not self._queue:
                return
            
            # Check if we can process more requests
            available_slots = self.config.max_concurrent_requests - len(self._active_requests)
            if available_slots <= 0:
                return
            
            # Check if we have tokens
            async with self._token_lock:
                if self._tokens < 1.0:
                    return
            
            # Process requests from queue
            processed = 0
            while self._queue and processed < available_slots:
                req = self._queue.popleft()
                
                # Check if request timed out
                if time.time() - req.enqueue_time > self.config.queue_timeout:
                    if not req.future.done():
                        req.future.set_exception(
                            asyncio.TimeoutError("Request timed out in queue")
                        )
                    self._total_rejected += 1
                    continue
                
                # Grant the request
                if not req.future.done():
                    req.future.set_result(True)
                    self._active_requests.add(req.request_id)
                    processed += 1
    
    @asynccontextmanager
    async def acquire(self, user_id: str, request_id: str | None = None) -> AsyncIterator[None]:
        """Acquire permission to make a request to OpenRouter.
        
        Returns a context manager that:
        1. Waits in queue if at capacity
        2. Consumes a token when request starts
        3. Releases the slot when request completes
        4. Records rate limit errors for backoff
        
        Raises:
            asyncio.TimeoutError: If queue wait exceeds timeout
            RuntimeError: If rate limiter is at capacity
        """
        request_id = request_id or str(uuid.uuid4())
        
        # Check if we're in backoff state
        if self._is_in_backoff():
            raise RuntimeError(
                f"Rate limiter in backoff state. Wait {self._current_backoff:.1f}s"
            )
        
        # Try to acquire immediately
        async with self._token_lock:
            if self._tokens >= 1.0 and len(self._active_requests) < self.config.max_concurrent_requests:
                self._tokens -= 1.0
                self._active_requests.add(request_id)
                self._total_requests += 1
                
                try:
                    yield
                finally:
                    self._active_requests.discard(request_id)
                return
        
        # Need to queue the request
        future = asyncio.Future()
        req = QueuedRequest(
            user_id=user_id,
            request_id=request_id,
            future=future,
        )
        
        async with self._queue_lock:
            if len(self._queue) >= self.config.max_queue_size:
                self._total_rejected += 1
                raise RuntimeError("Request queue is full. Try again later.")
            
            self._queue.append(req)
            self._total_queued += 1
        
        # Wait for queue processing
        try:
            await asyncio.wait_for(future, timeout=self.config.queue_timeout)
        except asyncio.TimeoutError:
            self._total_rejected += 1
            raise
        
        # Acquired permission
        async with self._token_lock:
            self._tokens -= 1.0
        self._total_requests += 1
        
        try:
            yield
        finally:
            self._active_requests.discard(request_id)
    
    def _is_in_backoff(self) -> bool:
        """Check if we're in backoff state due to rate limit errors."""
        if self._last_rate_limit_error == 0.0:
            return False
        
        elapsed = time.time() - self._last_rate_limit_error
        return elapsed < self._current_backoff
    
    def record_rate_limit_error(self) -> None:
        """Record a rate limit error from OpenRouter and increase backoff."""
        self._last_rate_limit_error = time.time()
        self._total_rate_limited += 1
        
        # Exponential backoff
        self._current_backoff = min(
            self.config.max_backoff,
            self._current_backoff * self.config.backoff_multiplier
        )
        
        log.warning(
            "Rate limit error recorded. Backoff increased to %.1fs",
            self._current_backoff,
        )
    
    def record_success(self) -> None:
        """Record a successful request and reduce backoff."""
        if self._current_backoff > self.config.initial_backoff:
            self._current_backoff = max(
                self.config.initial_backoff,
                self._current_backoff / self.config.backoff_multiplier
            )
    
    def get_metrics(self) -> dict:
        """Get rate limiter metrics."""
        return {
            "total_requests": self._total_requests,
            "total_queued": self._total_queued,
            "total_rejected": self._total_rejected,
            "total_rate_limited": self._total_rate_limited,
            "active_requests": len(self._active_requests),
            "queued_requests": len(self._queue),
            "available_tokens": self._tokens,
            "in_backoff": self._is_in_backoff(),
            "current_backoff": self._current_backoff,
        }
