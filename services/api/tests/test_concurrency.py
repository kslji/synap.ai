"""Tests for gateway concurrency management."""
import asyncio
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

from app.gateway.concurrency import ConcurrencyManager, CircuitBreaker, CircuitState


class TestCircuitBreaker:
    """Test circuit breaker functionality."""
    
    def test_initial_state_is_closed(self):
        """Circuit breaker starts in CLOSED state."""
        cb = CircuitBreaker()
        assert cb.state == CircuitState.CLOSED
        assert cb.can_execute() is True
    
    def test_opens_after_failure_threshold(self):
        """Circuit breaker opens after N failures."""
        cb = CircuitBreaker(failure_threshold=3)
        
        # Record 3 failures
        for _ in range(3):
            cb.record_failure()
        
        assert cb.state == CircuitState.OPEN
        assert cb.can_execute() is False
    
    def test_transitions_to_half_open_after_timeout(self):
        """Circuit breaker transitions to HALF_OPEN after recovery timeout."""
        import time
        cb = CircuitBreaker(failure_threshold=2, recovery_timeout=0.1)
        
        # Trip the circuit
        cb.record_failure()
        cb.record_failure()
        assert cb.state == CircuitState.OPEN
        
        # Wait for recovery timeout
        time.sleep(0.15)
        
        # Should transition to HALF_OPEN
        assert cb.can_execute() is True
        assert cb.state == CircuitState.HALF_OPEN
    
    def test_closes_after_success_in_half_open(self):
        """Circuit breaker closes after N successes in HALF_OPEN."""
        import time
        cb = CircuitBreaker(failure_threshold=2, recovery_timeout=0.1, success_threshold=2)
        
        # Trip the circuit
        cb.record_failure()
        cb.record_failure()
        assert cb.state == CircuitState.OPEN
        
        # Wait and transition to HALF_OPEN
        time.sleep(0.15)
        cb.can_execute()
        assert cb.state == CircuitState.HALF_OPEN
        
        # Record successes
        cb.record_success()
        assert cb.state == CircuitState.HALF_OPEN
        cb.record_success()
        assert cb.state == CircuitState.CLOSED
    
    def test_reopens_on_failure_in_half_open(self):
        """Circuit breaker re-opens on any failure in HALF_OPEN."""
        import time
        cb = CircuitBreaker(failure_threshold=2, recovery_timeout=0.1)
        
        # Trip the circuit
        cb.record_failure()
        cb.record_failure()
        
        # Wait and transition to HALF_OPEN
        time.sleep(0.15)
        cb.can_execute()
        assert cb.state == CircuitState.HALF_OPEN
        
        # Record failure
        cb.record_failure()
        assert cb.state == CircuitState.OPEN


class TestConcurrencyManager:
    """Test per-user concurrency control."""
    
    @pytest.mark.asyncio
    async def test_allows_single_request_per_user(self):
        """Only 1 concurrent request per user by default."""
        manager = ConcurrencyManager(max_concurrent_per_user=1)
        await manager.start()
        
        try:
            async with manager.user_scope("user_123"):
                # First request acquired lock
                stats = manager.get_user_stats("user_123")
                assert stats["active_requests"] == 1
        finally:
            await manager.stop()
    
    @pytest.mark.asyncio
    async def test_blocks_concurrent_requests_from_same_user(self):
        """Second concurrent request from same user raises TimeoutError."""
        manager = ConcurrencyManager(max_concurrent_per_user=1)
        await manager.start()
        
        try:
            async with manager.user_scope("user_123"):
                # Try to acquire again (should fail)
                with pytest.raises(asyncio.TimeoutError):
                    async with manager.user_scope("user_123"):
                        pass
        finally:
            await manager.stop()
    
    @pytest.mark.asyncio
    async def test_allows_concurrent_requests_from_different_users(self):
        """Different users can make concurrent requests."""
        manager = ConcurrencyManager(max_concurrent_per_user=1)
        await manager.start()
        
        try:
            async with manager.user_scope("user_A"):
                async with manager.user_scope("user_B"):
                    # Both users have active requests
                    stats_a = manager.get_user_stats("user_A")
                    stats_b = manager.get_user_stats("user_B")
                    assert stats_a["active_requests"] == 1
                    assert stats_b["active_requests"] == 1
                    assert manager.total_active_requests == 2
        finally:
            await manager.stop()
    
    @pytest.mark.asyncio
    async def test_releases_lock_after_completion(self):
        """Lock is released after request completes."""
        manager = ConcurrencyManager(max_concurrent_per_user=1)
        await manager.start()
        
        try:
            # First request
            async with manager.user_scope("user_123"):
                pass
            
            # Second request should succeed
            async with manager.user_scope("user_123"):
                stats = manager.get_user_stats("user_123")
                assert stats["active_requests"] == 1
        finally:
            await manager.stop()
    
    @pytest.mark.asyncio
    async def test_tracks_total_requests(self):
        """Tracks total number of requests per user."""
        manager = ConcurrencyManager(max_concurrent_per_user=1)
        await manager.start()
        
        try:
            # Make 3 sequential requests
            for _ in range(3):
                async with manager.user_scope("user_123"):
                    pass
            
            stats = manager.get_user_stats("user_123")
            assert stats["total_requests"] == 3
        finally:
            await manager.stop()
    
    @pytest.mark.asyncio
    async def test_global_stats(self):
        """Global stats track all users and requests."""
        manager = ConcurrencyManager(max_concurrent_per_user=1)
        await manager.start()
        
        try:
            async with manager.user_scope("user_A"):
                async with manager.user_scope("user_B"):
                    stats = manager.get_global_stats()
                    assert stats["total_active_requests"] == 2
                    assert stats["total_users"] == 2
                    assert stats["circuit_state"] == "closed"
        finally:
            await manager.stop()
    
    @pytest.mark.asyncio
    async def test_cleans_up_stale_users(self):
        """Stale user entries are cleaned up."""
        manager = ConcurrencyManager(
            max_concurrent_per_user=1,
            cleanup_interval=0.1,
            stale_threshold=0.05,
        )
        await manager.start()
        
        try:
            # Make a request
            async with manager.user_scope("user_123"):
                pass
            
            # Wait for cleanup
            await asyncio.sleep(0.2)
            
            # User should be cleaned up
            stats = manager.get_user_stats("user_123")
            assert stats["active_requests"] == 0
            assert stats["total_requests"] == 0
        finally:
            await manager.stop()


class TestCircuitBreakerIntegration:
    """Test circuit breaker integration with concurrency manager."""
    
    @pytest.mark.asyncio
    async def test_circuit_breaker_in_global_stats(self):
        """Circuit breaker state is included in global stats."""
        manager = ConcurrencyManager(max_concurrent_per_user=1)
        await manager.start()
        
        try:
            # Trip the circuit breaker
            for _ in range(5):
                manager.circuit_breaker.record_failure()
            
            stats = manager.get_global_stats()
            assert stats["circuit_state"] == "open"
            assert stats["circuit_failures"] == 5
        finally:
            await manager.stop()
